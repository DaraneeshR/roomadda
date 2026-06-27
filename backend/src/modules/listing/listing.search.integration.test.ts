import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { listingRoutes } from "./listing.route.js";

/**
 * Discovery reads: filtered browse + geo nearby. Every path returns the MASKED
 * public shape (alias/area only — never actualName/fullAddress), is cursor-
 * paginated, and nearby is index-backed (ST_DWithin on the GIST geography index).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const suffix = randomUUID().slice(0, 8);
const CITY = `Disco_${suffix}`;
const TAG = `tag_${suffix}`;

function isMasked(item: Record<string, unknown>): boolean {
  return item.masked === true && !("actualName" in item) && !("fullAddress" in item);
}

describe("listing discovery: filters + nearby (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let nearId: string; // Bangalore, FEMALE, has AC + an AVAILABLE bed, rent 8k
  let farId: string; // Mumbai, MALE, no AC, bed BLOCKED, rent 15k

  async function makeListing(opts: {
    gender: "MALE" | "FEMALE" | "COED";
    amenities: string[];
    lat: number;
    lng: number;
    rentPaise: number;
    bedStatus: "AVAILABLE" | "BLOCKED";
  }): Promise<string> {
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias: "Disco PG",
        areaLabel: "Area",
        city: CITY,
        actualName: "Disco Real Name",
        fullAddress: "1 Disco Road",
        pincode: "560001",
        latitude: opts.lat,
        longitude: opts.lng,
        gender: opts.gender,
        amenities: opts.amenities,
        status: "PUBLISHED",
      },
    });
    const room = await prisma.room.create({
      data: { listingId: listing.id, name: "R", sharingType: 2, monthlyRentPaise: opts.rentPaise, depositPaise: 0 },
    });
    await prisma.bed.create({ data: { roomId: room.id, label: "B1", status: opts.bedStatus } });
    return listing.id;
  }

  async function browse(qs: string) {
    const res = await app.inject({ method: "GET", url: `/v1/listings${qs}` });
    return res.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
  }

  const idsIn = (qs: string) => browse(qs).then((p) => p.items.map((i) => i.id as string));

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(listingRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    nearId = await makeListing({ gender: "FEMALE", amenities: ["WiFi", "AC", TAG], lat: 12.9716, lng: 77.5946, rentPaise: 800_000, bedStatus: "AVAILABLE" });
    farId = await makeListing({ gender: "MALE", amenities: ["WiFi", TAG], lat: 19.076, lng: 72.8777, rentPaise: 1_500_000, bedStatus: "BLOCKED" });
  });

  afterAll(async () => {
    await prisma.bed.deleteMany({ where: { room: { listing: { city: CITY } } } });
    await prisma.room.deleteMany({ where: { listing: { city: CITY } } });
    await prisma.pgListing.deleteMany({ where: { city: CITY } });
    await prisma.user.deleteMany({ where: { id: host.id } });
    await app.close();
    await prisma.$disconnect();
  });

  it("returns both listings for the city, all masked", async () => {
    const page = await browse(`?city=${CITY}`);
    expect(page.items.map((i) => i.id).sort()).toEqual([nearId, farId].sort());
    expect(page.items.every(isMasked)).toBe(true);
  });

  it("filters by gender", async () => {
    expect(await idsIn(`?city=${CITY}&gender=FEMALE`)).toEqual([nearId]);
  });

  it("filters by rent range (on room rent)", async () => {
    expect(await idsIn(`?city=${CITY}&minRentPaise=1000000`)).toEqual([farId]);
    expect(await idsIn(`?city=${CITY}&maxRentPaise=1000000`)).toEqual([nearId]);
  });

  it("filters by amenities (hasEvery)", async () => {
    expect(await idsIn(`?city=${CITY}&amenities=WiFi,AC`)).toEqual([nearId]);
  });

  it("filters by moveInDate (availability proxy: only a free bed)", async () => {
    expect(await idsIn(`?city=${CITY}&moveInDate=2026-07-01`)).toEqual([nearId]);
  });

  it("is cursor-paginated", async () => {
    const first = await browse(`?city=${CITY}&limit=1`);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await browse(`?city=${CITY}&limit=1&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it("GET /listings/:id returns the masked shape to an anonymous caller", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/listings/${nearId}` });
    expect(res.statusCode).toBe(200);
    expect(isMasked(res.json().listing)).toBe(true);
  });

  it("nearby (ST_DWithin) returns the near listing masked, excludes the far one", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/listings/search/nearby?lat=12.9716&lng=77.5946&radiusM=5000`,
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain(farId);
    const near = items.find((i) => i.id === nearId)!;
    expect(isMasked(near)).toBe(true);
    expect(typeof near.distanceMeters).toBe("number");
  });
});
