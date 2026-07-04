import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import type { AreaInsights } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { areaRoutes } from "./area.route.js";

/**
 * Area insights over LIVE listings. Bands are computed from real seeded rooms and
 * are PUBLISHED-only: a DRAFT listing and a host-paused one in the same area must
 * NOT move the min/max/median, and a same-named area in another city is excluded
 * when the query is city-scoped.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const suffix = randomUUID().slice(0, 8);
const AREA = `Insights_${suffix}`;
const CITY = `City_${suffix}`;

describe("area insights (integration)", () => {
  let app: FastifyInstance;
  let host: User;

  async function makeListing(opts: {
    city: string;
    gender: "MALE" | "FEMALE" | "COED";
    status: "PUBLISHED" | "DRAFT";
    paused?: boolean;
    rooms: Array<{ sharingType: number; rentPaise: number }>;
  }): Promise<string> {
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias: "Insights PG",
        areaLabel: AREA,
        city: opts.city,
        actualName: "Insights Real Name",
        fullAddress: "1 Insights Road",
        pincode: "560001",
        latitude: 12.97,
        longitude: 77.59,
        gender: opts.gender,
        status: opts.status,
        paused: opts.paused ?? false,
      },
    });
    for (const [i, r] of opts.rooms.entries()) {
      const room = await prisma.room.create({
        data: { listingId: listing.id, name: `R${i}`, sharingType: r.sharingType, monthlyRentPaise: r.rentPaise, depositPaise: 0 },
      });
      await prisma.bed.create({ data: { roomId: room.id, label: `B${i}`, status: "AVAILABLE" } });
    }
    return listing.id;
  }

  async function insights(qs = ""): Promise<AreaInsights> {
    const res = await app.inject({ method: "GET", url: `/v1/areas/${encodeURIComponent(AREA)}/insights${qs}` });
    expect(res.statusCode).toBe(200);
    return res.json() as AreaInsights;
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(areaRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });

    // Live inventory in CITY: two published listings feed the bands.
    await makeListing({ city: CITY, gender: "FEMALE", status: "PUBLISHED", rooms: [{ sharingType: 2, rentPaise: 800_000 }, { sharingType: 1, rentPaise: 1_200_000 }] });
    await makeListing({ city: CITY, gender: "MALE", status: "PUBLISHED", rooms: [{ sharingType: 3, rentPaise: 1_000_000 }] });
    // Excluded: a DRAFT (cheap) and a host-paused (expensive) listing — neither may
    // touch the min/max/median.
    await makeListing({ city: CITY, gender: "COED", status: "DRAFT", rooms: [{ sharingType: 1, rentPaise: 100 }] });
    await makeListing({ city: CITY, gender: "COED", status: "PUBLISHED", paused: true, rooms: [{ sharingType: 1, rentPaise: 9_999_999 }] });
    // Same area name, DIFFERENT city — excluded when the query is city-scoped.
    await makeListing({ city: "OtherCity", gender: "COED", status: "PUBLISHED", rooms: [{ sharingType: 2, rentPaise: 5_000_000 }] });
  });

  afterAll(async () => {
    await prisma.bed.deleteMany({ where: { room: { listing: { areaLabel: AREA } } } });
    await prisma.room.deleteMany({ where: { listing: { areaLabel: AREA } } });
    await prisma.pgListing.deleteMany({ where: { areaLabel: AREA } });
    await prisma.user.deleteMany({ where: { id: host.id } });
    await app.close();
    await prisma.$disconnect();
  });

  it("computes bands from PUBLISHED listings only (excludes DRAFT + paused)", async () => {
    const body = await insights(`?city=${encodeURIComponent(CITY)}`);
    expect(body.listingCount).toBe(2);
    expect(body.roomCount).toBe(3);
    // Rooms {8k, 12k, 10k} -> min 8k, median 10k, max 12k. The DRAFT's ₹1 and the
    // paused listing's ₹99,999 never enter these.
    expect(body.overall).toMatchObject({
      minPaise: 800_000,
      typicalPaise: 1_000_000,
      maxPaise: 1_200_000,
      avgPaise: 1_000_000,
      roomCount: 3,
    });
  });

  it("splits bands by gender and by room type", async () => {
    const body = await insights(`?city=${encodeURIComponent(CITY)}`);
    const female = body.byGender.find((g) => g.gender === "FEMALE");
    expect(female?.band).toMatchObject({ minPaise: 800_000, maxPaise: 1_200_000, roomCount: 2 });
    expect(body.byGender.some((g) => g.gender === "COED")).toBe(false); // no live co-ed inventory

    const sharings = body.byRoomType.map((t) => t.sharingType);
    expect(sharings).toEqual([1, 2, 3]); // ascending, only types present
    expect(body.byRoomType.find((t) => t.sharingType === 2)?.band.typicalPaise).toBe(800_000);
  });

  it("builds a histogram that accounts for every priced room", async () => {
    const body = await insights(`?city=${encodeURIComponent(CITY)}`);
    expect(body.histogram.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it("scopes to the city when asked, but spans cities without one", async () => {
    const scoped = await insights(`?city=${encodeURIComponent(CITY)}`);
    expect(scoped.overall?.maxPaise).toBe(1_200_000); // OtherCity's ₹50k excluded

    const all = await insights();
    expect(all.roomCount).toBe(4); // includes the OtherCity room
    expect(all.overall?.maxPaise).toBe(5_000_000);
  });
});
