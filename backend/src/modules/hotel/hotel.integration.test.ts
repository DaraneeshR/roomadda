import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HotelRoom, HotelRoomCategory, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { listingService } from "../listing/listing.service.js";
import { toPublicListing } from "../listing/serializer.js";

/**
 * Hotel B2C add-on — schema-gate proofs (no booking flow yet):
 *  1. The nightly OVERBOOKING GUARD rejects an overlapping-date-range double-book
 *     at the DB level (the exclusion constraint no_overlapping_hotel_reservation),
 *     exactly like the bed partial-unique-index guard.
 *  2. Server-side VISIBILITY enforcement: a CORPORATE_ONLY listing NEVER appears in
 *     a B2C (consumer) query; USER_ONLY + BOTH do.
 *  3. Existing PG behaviour is unchanged: a listing created without the new fields
 *     defaults to PG + USER_ONLY and its public serialization is byte-for-byte the
 *     same (no propertyType / visibility keys leak into the DTO).
 */

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("hotel add-on schema gate (integration)", () => {
  let host: User;
  // Unique city so the B2C browse assertion only sees this test's listings.
  const city = `HotelTest-${randomUUID().slice(0, 8)}`;
  const listingIds: string[] = [];

  /** Create a PUBLISHED listing with the given property type + visibility. */
  async function makeListing(
    propertyType: PgListing["propertyType"],
    visibility: PgListing["visibility"],
    alias: string,
  ): Promise<PgListing> {
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias,
        areaLabel: "Area",
        city,
        actualName: `${alias} Real`,
        fullAddress: "1 Test Road",
        pincode: "560001",
        latitude: 12.9,
        longitude: 77.6,
        status: "PUBLISHED",
        propertyType,
        visibility,
      },
    });
    listingIds.push(l.id);
    return l;
  }

  beforeAll(async () => {
    host = await prisma.user.create({
      data: { phone: uniquePhone(), fullName: "Hotel Host", role: "HOST", isPhoneVerified: true },
    });
  });

  afterAll(async () => {
    // pg_listings cascade to hotel_room_categories -> hotel_rooms -> hotel_reservations.
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: host.id } });
    await prisma.$disconnect();
  });

  // ---- 3. PG unchanged -----------------------------------------------------
  it("a listing created WITHOUT the new fields defaults to PG + USER_ONLY", async () => {
    // Bypass zod defaults: write the raw Prisma create with neither field set, to
    // prove the DB column defaults (not just the schema defaults) preserve behaviour.
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias: "Legacy PG",
        areaLabel: "Area",
        city,
        actualName: "Legacy PG Real",
        fullAddress: "1 Test Road",
        pincode: "560001",
        latitude: 12.9,
        longitude: 77.6,
        status: "PUBLISHED",
      },
    });
    listingIds.push(l.id);
    expect(l.propertyType).toBe("PG");
    expect(l.visibility).toBe("USER_ONLY");

    // Byte-for-byte: the public DTO must NOT carry the new fields.
    const full = await listingService.getById(l.id);
    const pub = toPublicListing(full!);
    expect(pub).not.toHaveProperty("propertyType");
    expect(pub).not.toHaveProperty("visibility");
  });

  // ---- 2. Visibility enforcement ------------------------------------------
  it("a CORPORATE_ONLY listing is ABSENT from a B2C browse; USER_ONLY + BOTH present", async () => {
    const pg = await makeListing("PG", "USER_ONLY", "B2C PG");
    const hotelUser = await makeListing("HOTEL", "USER_ONLY", "B2C Hotel");
    const hotelBoth = await makeListing("HOTEL", "BOTH", "Dual Hotel");
    const hotelCorp = await makeListing("HOTEL", "CORPORATE_ONLY", "Corporate Hotel");

    // The B2C consumer browse (listPublished folds in visibilityWhere("B2C")).
    const page = await listingService.listPublished({ city, limit: 50 });
    const ids = new Set(page.items.map((l) => l.id));

    expect(ids.has(pg.id)).toBe(true); // PG, USER_ONLY
    expect(ids.has(hotelUser.id)).toBe(true); // HOTEL, USER_ONLY
    expect(ids.has(hotelBoth.id)).toBe(true); // HOTEL, BOTH
    expect(ids.has(hotelCorp.id)).toBe(false); // HOTEL, CORPORATE_ONLY -> NEVER in B2C
  });

  // ---- 1. Overbooking guard (the critical correctness item) ----------------
  describe("nightly overbooking guard", () => {
    let category: HotelRoomCategory;
    let roomA: HotelRoom; // B2C pool
    let roomB: HotelRoom; // corporate pool

    const PER_NIGHT = 500_000; // paise

    /** Build a reservation payload with money snapshot derived from the range. */
    function reservationData(
      room: HotelRoom,
      checkIn: string,
      checkOut: string,
      status: "HELD" | "CONFIRMED" | "CANCELLED" | "EXPIRED",
    ) {
      const nights = Math.round((day(checkOut).getTime() - day(checkIn).getTime()) / 86_400_000);
      return {
        hotelRoomId: room.id,
        categoryId: category.id,
        listingId: category.listingId,
        channel: room.channel,
        status,
        checkIn: day(checkIn),
        checkOut: day(checkOut),
        perNightPaise: PER_NIGHT,
        nights,
        roomTotalPaise: nights * PER_NIGHT,
      };
    }

    beforeAll(async () => {
      const listing = await makeListing("HOTEL", "USER_ONLY", "Guard Hotel");
      category = await prisma.hotelRoomCategory.create({
        data: {
          listingId: listing.id,
          tier: "Deluxe",
          perNightPaise: PER_NIGHT,
          totalRooms: 2,
          corporateReservedRooms: 1, // hard carve-out: 1 B2C unit + 1 corporate unit
        },
      });
      // Materialised units (the nightly analog of Beds), physically split by channel.
      roomA = await prisma.hotelRoom.create({ data: { categoryId: category.id, label: "101", channel: "B2C" } });
      roomB = await prisma.hotelRoom.create({ data: { categoryId: category.id, label: "201", channel: "CORPORATE" } });
    });

    it("accepts the first HELD reservation on a room", async () => {
      const res = await prisma.hotelReservation.create({
        data: reservationData(roomA, "2026-08-01", "2026-08-05", "HELD"),
      });
      expect(res.status).toBe("HELD");
      expect(res.roomTotalPaise).toBe(4 * PER_NIGHT);
    });

    it("REJECTS an overlapping-date-range second live booking on the SAME room (DB level)", async () => {
      // [Aug 3, Aug 7) overlaps the live [Aug 1, Aug 5) hold on roomA — the exclusion
      // constraint must reject it even though we bypass all app code.
      await expect(
        prisma.hotelReservation.create({ data: reservationData(roomA, "2026-08-03", "2026-08-07", "HELD") }),
      ).rejects.toThrow();
    });

    it("ALLOWS a same-day turnover (back-to-back, half-open ranges) on the same room", async () => {
      // [Aug 5, Aug 8) starts exactly when [Aug 1, Aug 5) ends — no night overlaps.
      const res = await prisma.hotelReservation.create({
        data: reservationData(roomA, "2026-08-05", "2026-08-08", "HELD"),
      });
      expect(res.status).toBe("HELD");
    });

    it("ALLOWS the same overlapping dates on a DIFFERENT room", async () => {
      const res = await prisma.hotelReservation.create({
        data: reservationData(roomB, "2026-08-03", "2026-08-07", "HELD"),
      });
      expect(res.hotelRoomId).toBe(roomB.id);
    });

    it("IGNORES a non-live (CANCELLED) reservation when checking overlap", async () => {
      // A CANCELLED hold overlapping roomA's live window is allowed — only
      // HELD|CONFIRMED participate in the guard (the WHERE clause).
      const res = await prisma.hotelReservation.create({
        data: reservationData(roomA, "2026-08-02", "2026-08-04", "CANCELLED"),
      });
      expect(res.status).toBe("CANCELLED");
    });

    it("cannot reserve a room that does not exist (FK bounds total capacity)", async () => {
      await expect(
        prisma.hotelReservation.create({
          data: {
            hotelRoomId: randomUUID(),
            categoryId: category.id,
            listingId: category.listingId,
            channel: "B2C",
            status: "HELD",
            checkIn: day("2026-09-01"),
            checkOut: day("2026-09-03"),
            perNightPaise: PER_NIGHT,
            nights: 2,
            roomTotalPaise: 2 * PER_NIGHT,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
