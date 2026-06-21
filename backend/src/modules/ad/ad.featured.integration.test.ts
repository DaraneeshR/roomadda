import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { adRoutes } from "./ad.route.js";
import { adService, invalidateFeaturedCache } from "./ad.service.js";

/**
 * HTTP-level test for the public GET /v1/featured endpoint and the ad-expiry
 * sweep. Proves the task guarantee: an APPROVED ad whose window has ended is
 * NOT returned by /v1/featured, and the sweep flips it to EXPIRED (while an
 * in-window ad keeps appearing and stays APPROVED).
 *
 * Builds a minimal app (auth plugin is required only so the protected ad routes
 * can register; /featured itself is public) and depends on a live Postgres +
 * Redis, like the rest of the integration suite.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

async function buildFeaturedApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(adRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

async function seedListing(host: User, alias: string): Promise<PgListing> {
  const listing = await prisma.pgListing.create({
    data: {
      hostId: host.id, alias, areaLabel: "Area", city: "FeaturedCity",
      actualName: `${alias} Real Name`, fullAddress: "1 Test Road", pincode: "560001",
      latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
    },
  });
  const room = await prisma.room.create({
    data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
  });
  await prisma.bed.create({ data: { roomId: room.id, label: "A1", status: "AVAILABLE" } });
  await prisma.listingPhoto.create({
    data: { listingId: listing.id, url: "https://example.test/p.jpg", isPrimary: true, sortOrder: 0 },
  });
  return listing;
}

describe("featured ads + ad-expiry sweep (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let inWindow: PgListing;
  let outOfWindow: PgListing;
  let outAdId: string;
  let inAdId: string;

  beforeAll(async () => {
    app = await buildFeaturedApp();
    host = await prisma.user.create({
      data: { phone: uniquePhone(), fullName: "Featured Host", role: "HOST", isPhoneVerified: true },
    });
    inWindow = await seedListing(host, "Featured In-Window");
    outOfWindow = await seedListing(host, "Featured Out-Of-Window");

    const now = Date.now();
    const inAd = await prisma.adSlot.create({
      data: {
        listingId: inWindow.id, createdById: host.id, slotType: "DAY",
        startDate: new Date(now - 3_600_000), endDate: new Date(now + 86_400_000),
        pricePaise: 50_000, status: "APPROVED", approvedById: host.id, approvedAt: new Date(),
        razorpayOrderId: `itest_in_${randomUUID()}`,
      },
    });
    // APPROVED but the window has already ended: must NOT be featured.
    const outAd = await prisma.adSlot.create({
      data: {
        listingId: outOfWindow.id, createdById: host.id, slotType: "DAY",
        startDate: new Date(now - 2 * 86_400_000), endDate: new Date(now - 86_400_000),
        pricePaise: 50_000, status: "APPROVED", approvedById: host.id, approvedAt: new Date(),
        razorpayOrderId: `itest_out_${randomUUID()}`,
      },
    });
    inAdId = inAd.id;
    outAdId = outAd.id;
  });

  afterAll(async () => {
    await prisma.adSlot.deleteMany({ where: { id: { in: [inAdId, outAdId] } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: [inWindow.id, outOfWindow.id] } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: [inWindow.id, outOfWindow.id] } } });
    await prisma.listingPhoto.deleteMany({ where: { listingId: { in: [inWindow.id, outOfWindow.id] } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: [inWindow.id, outOfWindow.id] } } });
    await prisma.user.deleteMany({ where: { id: host.id } });
    await invalidateFeaturedCache();
    await app.close();
    await redis.quit();
    await prisma.$disconnect();
  });

  it("GET /v1/featured excludes an out-of-window slot but includes an in-window one", async () => {
    await invalidateFeaturedCache(); // read from the DB, not a stale cached set
    const res = await app.inject({ method: "GET", url: "/v1/featured?limit=20" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((l) => l.id);
    expect(ids).toContain(inWindow.id);
    expect(ids).not.toContain(outOfWindow.id);
  });

  it("the ad-expiry sweep flips the ended slot to EXPIRED and leaves the live one APPROVED", async () => {
    const expired = await adService.expireEndedAdSlots();
    expect(expired).toBeGreaterThanOrEqual(1);

    const out = await prisma.adSlot.findUniqueOrThrow({ where: { id: outAdId } });
    const live = await prisma.adSlot.findUniqueOrThrow({ where: { id: inAdId } });
    expect(out.status).toBe("EXPIRED");
    expect(live.status).toBe("APPROVED");
  });
});
