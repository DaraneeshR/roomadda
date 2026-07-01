import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bed, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { stayRoutes } from "./stay.route.js";

/**
 * HTTP-level tests for GET /v1/me/active-stay — the post-move-in tenant
 * dashboard feed. The route is the real wiring (authenticate + requireRole +
 * caller scoping + serializer). Bookings are seeded directly so each scenario
 * is independent of the payment/webhook flow.
 *
 * Builds a minimal app (no Redis-backed rate limiter) so the test depends only
 * on a live Postgres, like the rest of the integration suite.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

const DAY_MS = 24 * 60 * 60 * 1000;

async function buildStayApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(stayRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

describe("GET /v1/me/active-stay (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let listing: PgListing;
  let room: Room;

  // One tenant per scenario so each is independent of the others' bookings.
  let tenantActive: User; // CONFIRMED, moved in yesterday
  let tenantFuture: User; // CONFIRMED, moves in tomorrow
  let tenantPending: User; // TOKEN_PENDING, "moved in" yesterday (not confirmed)
  let tenantNone: User; // no bookings at all
  let activeBookingId: string;

  const tokenFor = (u: User) => signAccessToken({ sub: u.id, role: u.role });

  const freshBed = (label: string): Promise<Bed> =>
    prisma.bed.create({
      data: { roomId: room.id, label: `${label}-${randomUUID().slice(0, 8)}`, status: "BOOKED" },
    });

  beforeAll(async () => {
    app = await buildStayApp();
    host = await prisma.user.create({
      data: { phone: uniquePhone(), fullName: "Host Hema", role: "HOST", isPhoneVerified: true },
    });
    tenantActive = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Active", role: "TENANT", isPhoneVerified: true } });
    tenantFuture = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Future", role: "TENANT", isPhoneVerified: true } });
    tenantPending = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Pending", role: "TENANT", isPhoneVerified: true } });
    tenantNone = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "None", role: "TENANT", isPhoneVerified: true } });

    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "StayTest PG", areaLabel: "Indiranagar", city: "Bengaluru",
        actualName: "Sunrise Residency", fullAddress: "1 Stay Road", pincode: "560038",
        latitude: 12.97, longitude: 77.64, status: "PUBLISHED",
      },
    });
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room 101", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 },
    });

    const now = Date.now();
    const baseBooking = (tenantId: string, bedId: string) => ({
      tenantId, bedId, listingId: listing.id,
      tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
    });

    const activeBooking = await prisma.booking.create({
      data: {
        ...baseBooking(tenantActive.id, (await freshBed("ACTIVE")).id),
        status: "CONFIRMED", confirmedAt: new Date(now - DAY_MS), moveInDate: new Date(now - DAY_MS),
        mealPlan: "Veg · 2 meals",
      },
    });
    activeBookingId = activeBooking.id;

    await prisma.booking.create({
      data: {
        ...baseBooking(tenantFuture.id, (await freshBed("FUTURE")).id),
        status: "CONFIRMED", confirmedAt: new Date(now), moveInDate: new Date(now + DAY_MS),
      },
    });

    await prisma.booking.create({
      data: {
        ...baseBooking(tenantPending.id, (await freshBed("PENDING")).id),
        status: "TOKEN_PENDING", moveInDate: new Date(now - DAY_MS), holdExpiresAt: new Date(now + DAY_MS),
      },
    });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
    await prisma.room.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [host.id, tenantActive.id, tenantFuture.id, tenantPending.id, tenantNone.id] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const get = (token?: string) =>
    app.inject({
      method: "GET",
      url: "/v1/me/active-stay",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });

  it("returns the caller's own CONFIRMED, moved-in booking with host emergency contact", async () => {
    const res = await get(await tokenFor(tenantActive));
    expect(res.statusCode).toBe(200);
    const stay = res.json().activeStay;
    expect(stay).not.toBeNull();
    expect(stay.bookingId).toBe(activeBookingId);
    // Unmasked PG name + room are allowed: the caller is a CONFIRMED tenant here.
    expect(stay.pgName).toBe("Sunrise Residency");
    expect(stay.roomName).toBe("Room 101");
    expect(stay.monthlyRentPaise).toBe(1_200_000);
    expect(typeof stay.moveInDate).toBe("string");
    expect(typeof stay.nextRentDueDate).toBe("string");
    // Next rent is due strictly after today.
    expect(new Date(stay.nextRentDueDate).getTime()).toBeGreaterThan(Date.now());
    // Host name + emergency contact are present (PRD: allowed on the dashboard).
    expect(stay.host.name).toBe("Host Hema");
    expect(stay.host.emergencyContactNumber).toBe(host.phone);
    expect(stay.features.mealMenuAvailable).toBe(true);
    expect(stay.features.leaveNoticeAvailable).toBe(true);
  });

  it("never exposes KYC or payment data", async () => {
    const res = await get(await tokenFor(tenantActive));
    const stay = res.json().activeStay;
    for (const key of ["payment", "kyc", "tokenAmountPaise", "depositPaise", "razorpayOrderId"]) {
      expect(stay).not.toHaveProperty(key);
    }
    // No payment leg leaks via the host object either.
    expect(Object.keys(stay.host)).toEqual(["name", "emergencyContactNumber"]);
  });

  it("returns null before the move-in date (pre-move-in)", async () => {
    const res = await get(await tokenFor(tenantFuture));
    expect(res.statusCode).toBe(200);
    expect(res.json().activeStay).toBeNull();
  });

  it("returns null for a moved-in booking that is not yet CONFIRMED", async () => {
    const res = await get(await tokenFor(tenantPending));
    expect(res.statusCode).toBe(200);
    expect(res.json().activeStay).toBeNull();
  });

  it("returns null when the caller has no stay — even though other tenants do", async () => {
    const res = await get(await tokenFor(tenantNone));
    expect(res.statusCode).toBe(200);
    expect(res.json().activeStay).toBeNull();
  });

  it("rejects a non-TENANT role with 403", async () => {
    const res = await get(await tokenFor(host));
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
  });
});
