import { Prisma, type HotelReservation } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { listingInclude, toPublicListing, type ListingWithRelations } from "../listing/serializer.js";
import { visibilityWhere, isVisibleTo } from "../listing/visibility.js";
import type {
  HotelCategoryAvailability,
  HotelSearchQuery,
  HotelSearchResult,
  CreateHotelReservationInput,
} from "@roomadda/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Payment window once a hotel room is held (mirrors the instant-book bed hold). */
const HOLD_TTL_MS = 15 * 60 * 1000;

/** Whole nights in a half-open [checkIn, checkOut) range (date-only inputs). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
const categoryNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "HOTEL_CATEGORY_NOT_FOUND", message: "Hotel room category not found" });
const noAvailability = (): AppError =>
  new AppError({ statusCode: 409, code: "NO_AVAILABILITY", message: "No rooms available for the selected dates" });

/** One row of the per-category availability query. */
interface CategoryAvailabilityRow {
  categoryId: string;
  listingId: string;
  tier: string;
  perNightPaise: number;
  photos: string[];
  amenities: string[];
  available: bigint;
}

/**
 * REAL B2C availability per category for a date range. `available` counts B2C
 * units (channel = 'B2C' — the corporate carve-out is physically excluded) that
 * have NO overlapping live (HELD|CONFIRMED) reservation across [checkIn, checkOut).
 * All params are bound (never interpolated — /CLAUDE.md). Empty ids -> no query.
 */
async function categoryAvailability(
  listingIds: string[],
  checkIn: Date,
  checkOut: Date,
): Promise<CategoryAvailabilityRow[]> {
  if (listingIds.length === 0) return [];
  const range = Prisma.sql`daterange(${checkIn}::date, ${checkOut}::date, '[)')`;
  return prisma.$queryRaw<CategoryAvailabilityRow[]>`
    SELECT
      c.id                AS "categoryId",
      c."listingId"       AS "listingId",
      c.tier              AS "tier",
      c."perNightPaise"   AS "perNightPaise",
      c.photos            AS "photos",
      c.amenities         AS "amenities",
      (
        SELECT COUNT(*) FROM hotel_rooms hr
        WHERE hr."categoryId" = c.id
          AND hr.channel = 'B2C'
          AND NOT EXISTS (
            SELECT 1 FROM hotel_reservations r
            WHERE r."hotelRoomId" = hr.id
              AND r.status IN ('HELD', 'CONFIRMED')
              AND daterange(r."checkIn", r."checkOut", '[)') && ${range}
          )
      ) AS "available"
    FROM hotel_room_categories c
    WHERE c."listingId"::text IN (${Prisma.join(listingIds)})
    ORDER BY c."perNightPaise" ASC
  `;
}

export const hotelService = {
  /**
   * Availability search. Returns MASKED HOTEL listings (visibility USER_ONLY|BOTH
   * only — a CORPORATE_ONLY property is NEVER in a B2C response) in the given city
   * (+ optional area), each with its bookable categories priced for the range and
   * the REAL number of free B2C rooms. Price + availability are 100% server-owned.
   * Cursor-paginated over the listing page (max page size enforced upstream).
   */
  async searchAvailability(query: HotelSearchQuery): Promise<{
    items: HotelSearchResult[];
    nextCursor: string | null;
    nights: number;
  }> {
    const nights = nightsBetween(query.checkIn, query.checkOut);

    const where: Prisma.PgListingWhereInput = {
      status: "PUBLISHED",
      paused: false,
      propertyType: "HOTEL",
      ...visibilityWhere("B2C"),
      city: { equals: query.city, mode: "insensitive" },
      ...(query.area ? { areaLabel: { contains: query.area, mode: "insensitive" } } : {}),
    };

    const rows = await prisma.pgListing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);

    const listingById = new Map<string, ListingWithRelations>(page.items.map((l) => [l.id, l]));
    const availability = await categoryAvailability([...listingById.keys()], query.checkIn, query.checkOut);

    // Group available (> 0) categories per listing, priced for the range.
    const byListing = new Map<string, HotelCategoryAvailability[]>();
    for (const row of availability) {
      const available = Number(row.available);
      if (available <= 0) continue; // search returns only bookable categories
      const list = byListing.get(row.listingId) ?? [];
      list.push({
        categoryId: row.categoryId,
        tier: row.tier,
        perNightPaise: row.perNightPaise,
        nights,
        totalPaise: row.perNightPaise * nights,
        availableRooms: available,
        photos: row.photos,
        amenities: row.amenities,
      });
      byListing.set(row.listingId, list);
    }

    // Only surface listings that actually have availability for the range.
    const items: HotelSearchResult[] = [];
    for (const listing of page.items) {
      const categories = byListing.get(listing.id);
      if (!categories || categories.length === 0) continue;
      items.push({ listing: toPublicListing(listing), categories });
    }

    return { items, nextCursor: page.nextCursor, nights };
  },

  /**
   * Provision a category's room UNITS to match its declared counts (idempotent).
   * Creates the missing B2C units (totalRooms − corporateReservedRooms) and
   * CORPORATE units (corporateReservedRooms). This is what the overbooking guard
   * and the corporate/B2C carve-out actually operate on. Safe to call repeatedly.
   */
  async provisionUnits(categoryId: string): Promise<{ b2c: number; corporate: number }> {
    const category = await prisma.hotelRoomCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, totalRooms: true, corporateReservedRooms: true },
    });
    if (!category) throw categoryNotFound();
    const wantCorporate = Math.max(0, category.corporateReservedRooms);
    const wantB2c = Math.max(0, category.totalRooms - wantCorporate);

    const existing = await prisma.hotelRoom.findMany({
      where: { categoryId },
      select: { channel: true },
    });
    const haveB2c = existing.filter((r) => r.channel === "B2C").length;
    const haveCorporate = existing.filter((r) => r.channel === "CORPORATE").length;

    const toCreate: Prisma.HotelRoomCreateManyInput[] = [];
    for (let i = haveB2c; i < wantB2c; i++) toCreate.push({ categoryId, label: `B2C-${i + 1}`, channel: "B2C" });
    for (let i = haveCorporate; i < wantCorporate; i++)
      toCreate.push({ categoryId, label: `CORP-${i + 1}`, channel: "CORPORATE" });
    if (toCreate.length > 0) await prisma.hotelRoom.createMany({ data: toCreate });

    return { b2c: Math.max(haveB2c, wantB2c), corporate: Math.max(haveCorporate, wantCorporate) };
  },

  /**
   * Hold a B2C room in a category for a date range. Allocates a free B2C unit under
   * a row lock (FOR UPDATE SKIP LOCKED) so concurrent holds serialize, with the
   * overbooking EXCLUDE constraint as the DB-level backstop (an overlapping-date
   * double-book is impossible). Price is snapshotted server-side (perNightPaise ×
   * nights) — NEVER client-computed. The reservation is HELD until the verified
   * webhook CONFIRMS it; money is never trusted from the client.
   */
  async createReservationHold(guestId: string, input: CreateHotelReservationInput): Promise<HotelReservation> {
    const category = await prisma.hotelRoomCategory.findUnique({
      where: { id: input.categoryId },
      select: {
        id: true,
        listingId: true,
        perNightPaise: true,
        listing: { select: { status: true, paused: true, propertyType: true, visibility: true } },
      },
    });
    // A category on a non-bookable listing (not a live HOTEL, or a CORPORATE_ONLY
    // property a B2C guest may not see) is reported as 404 — existence never leaked.
    if (
      !category ||
      category.listing.propertyType !== "HOTEL" ||
      category.listing.status !== "PUBLISHED" ||
      category.listing.paused ||
      !isVisibleTo("B2C", category.listing.visibility)
    ) {
      throw categoryNotFound();
    }

    const nights = nightsBetween(input.checkIn, input.checkOut);
    if (nights <= 0) {
      throw new AppError({ statusCode: 400, code: "INVALID_STAY_RANGE", message: "checkOut must be after checkIn" });
    }
    // SERVER-OWNED money. B2C hotel is full-stay prepay, so the token == the total.
    const perNightPaise = category.perNightPaise;
    const roomTotalPaise = perNightPaise * nights;
    const tokenAmountPaise = roomTotalPaise;
    assertPaise(perNightPaise);
    assertPaise(roomTotalPaise);
    if (roomTotalPaise <= 0) {
      throw new AppError({ statusCode: 400, code: "CATEGORY_NOT_BOOKABLE", message: "This category has no nightly price" });
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // Allocate a free B2C unit for the whole range, row-locked so a concurrent
        // hold can't take the same one (it SKIPs the locked row and picks another).
        const range = Prisma.sql`daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)')`;
        const free = await tx.$queryRaw<{ id: string }[]>`
          SELECT hr.id
          FROM hotel_rooms hr
          WHERE hr."categoryId" = ${category.id}::uuid
            AND hr.channel = 'B2C'
            AND NOT EXISTS (
              SELECT 1 FROM hotel_reservations r
              WHERE r."hotelRoomId" = hr.id
                AND r.status IN ('HELD', 'CONFIRMED')
                AND daterange(r."checkIn", r."checkOut", '[)') && ${range}
            )
          ORDER BY hr.label ASC
          LIMIT 1
          FOR UPDATE OF hr SKIP LOCKED
        `;
        const unit = free[0];
        if (!unit) throw noAvailability();

        return await tx.hotelReservation.create({
          data: {
            hotelRoomId: unit.id,
            categoryId: category.id,
            listingId: category.listingId,
            guestId,
            channel: "B2C",
            status: "HELD",
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            perNightPaise,
            nights,
            roomTotalPaise,
            tokenAmountPaise,
            holdExpiresAt: new Date(Date.now() + HOLD_TTL_MS),
          },
        });
      });
    } catch (err) {
      // The overbooking EXCLUDE constraint (23P01) rejected an overlapping insert —
      // the room was taken concurrently. Surface as "no availability", never a 500.
      if (isExclusionViolation(err)) throw noAvailability();
      throw err;
    }
  },

  /** One of the caller's own reservations (ownership enforced; non-owner -> 404). */
  async getForGuest(reservationId: string, guestId: string): Promise<HotelReservation> {
    const reservation = await prisma.hotelReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.guestId !== guestId) throw notFound();
    return reservation;
  },

  /** The caller's own reservations, newest first, cursor-paginated. */
  async listForGuest(
    guestId: string,
    input: { cursor?: string; limit: number },
  ): Promise<Page<HotelReservation>> {
    const rows = await prisma.hotelReservation.findMany({
      where: { guestId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, input.limit);
  },

  /** Receipt data for a CONFIRMED reservation (tenant-owned). */
  async getReceiptData(reservationId: string, guestId: string) {
    const r = await prisma.hotelReservation.findUnique({
      where: { id: reservationId },
      include: {
        guest: { select: { fullName: true } },
        category: { select: { tier: true } },
        // listing is masked-safe here: the receipt is for the CONFIRMED guest, who
        // is entitled to the real property name (same rule as the PG receipt).
      },
    });
    if (!r || r.guestId !== guestId) throw notFound();
    if (r.status !== "CONFIRMED") {
      throw new AppError({ statusCode: 409, code: "RECEIPT_NOT_READY", message: "Receipt is available once the reservation is confirmed" });
    }
    const listing = await prisma.pgListing.findUnique({
      where: { id: r.listingId },
      select: { actualName: true, areaLabel: true, city: true },
    });
    return {
      reservationId: r.id,
      guestName: r.guest?.fullName ?? "Guest",
      listingName: listing?.actualName ?? "",
      area: `${listing?.areaLabel ?? ""}, ${listing?.city ?? ""}`,
      tier: r.category.tier,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: r.nights,
      perNightPaise: r.perNightPaise,
      roomTotalPaise: r.roomTotalPaise,
      paymentId: r.razorpayPaymentId,
      qrCodeToken: r.qrCodeToken,
      confirmedAt: r.confirmedAt,
    };
  },
};

/** True when `err` is a Postgres exclusion-constraint violation (23P01). */
export function isExclusionViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma surfaces exclusion violations without a dedicated Pxxxx code; match by
    // the raw Postgres code / constraint name carried in the message or meta.
    const meta = err.meta as { code?: string; constraint?: string } | undefined;
    if (meta?.code === "23P01") return true;
    if (typeof meta?.constraint === "string" && meta.constraint.includes("no_overlapping_hotel_reservation")) return true;
  }
  const message = err instanceof Error ? err.message : "";
  return message.includes("23P01") || message.includes("no_overlapping_hotel_reservation");
}
