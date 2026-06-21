import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bed, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { bookingRoutes } from "./booking.route.js";
import { bookingService } from "./booking.service.js";
import { paymentService } from "./payment.service.js";
import { webhookService } from "./webhook.service.js";

/**
 * HTTP-level tests for the tenant booking-read routes. These exercise the real
 * route wiring (authenticate + requireRole(TENANT) + ownership) and serializer,
 * while confirmation is driven SOLELY through the verified webhook — exactly the
 * mobile flow: hold -> pay -> poll GET /v1/bookings/:id -> CONFIRMED.
 *
 * Builds a minimal app (no Redis-backed rate limiter) so the test depends only
 * on a live Postgres, like the rest of the booking integration suite.
 */
function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

async function buildReadApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(bookingRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

describe("tenant booking-read routes (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User;
  let otherTenant: User;
  let listing: PgListing;
  let room: Room;
  let tenantToken: string;
  let otherToken: string;
  let hostToken: string;

  beforeAll(async () => {
    app = await buildReadApp();
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant", role: "TENANT", isPhoneVerified: true } });
    otherTenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Other", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "ReadTest PG", areaLabel: "Area", city: "City",
        actualName: "ReadTest Real Name", fullAddress: "1 Test Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    otherToken = await signAccessToken({ sub: otherTenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.cashCollection.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
    await prisma.room.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_readtest_" } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, otherTenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const freshBed = (label: string): Promise<Bed> =>
    prisma.bed.create({ data: { roomId: room.id, label: `${label}-${randomUUID().slice(0, 8)}`, status: "AVAILABLE" } });

  const get = (url: string, token?: string) =>
    app.inject({ method: "GET", url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });

  it("a tenant reads their own TOKEN_PENDING booking: 200, masked listing, no private fields", async () => {
    const bed = await freshBed("OWN");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });

    const res = await get(`/v1/bookings/${booking.id}`, tenantToken);
    expect(res.statusCode).toBe(200);
    const body = res.json().booking;
    expect(body.status).toBe("TOKEN_PENDING");
    expect(body.confirmedAt).toBeNull();
    expect(body.holdExpiresAt).not.toBeNull();
    expect(body.tokenAmountPaise).toBe(booking.tokenAmountPaise);
    // Masked: public shape, none of the private listing fields leak.
    expect(body.listing.masked).toBe(true);
    for (const key of ["actualName", "fullAddress", "pincode", "location", "hostId"]) {
      expect(body.listing).not.toHaveProperty(key);
    }
    // No payment initiated yet.
    expect(body.payment).toBeNull();
  });

  it("a tenant requesting another tenant's booking id gets 404 (not 403)", async () => {
    const bed = await freshBed("FOREIGN");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });

    const res = await get(`/v1/bookings/${booking.id}`, otherToken);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("hold -> pay -> poll: webhook capture flips the polled booking to CONFIRMED (private)", async () => {
    const bed = await freshBed("FLOW");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });

    // Poll #1: still on hold, masked.
    const before = await get(`/v1/bookings/${booking.id}`, tenantToken);
    expect(before.json().booking.status).toBe("TOKEN_PENDING");
    expect(before.json().booking.listing.masked).toBe(true);

    // Pay the token online, then deliver the verified webhook (the ONLY confirmer).
    const pay = await paymentService.createTokenPayment(booking.id, tenant.id, {
      method: "ONLINE", onlinePaise: booking.tokenAmountPaise, cashPaise: 0,
    });
    const { raw, signature } = capturedEvent(pay.razorpayOrder?.orderId ?? "", booking.tokenAmountPaise);
    const result = await webhookService.processRazorpay(raw, signature, `evt_readtest_${randomUUID()}`);
    expect(result.status).toBe("processed");

    // Poll #2: CONFIRMED, unmasked private listing, capture timestamps present.
    const after = await get(`/v1/bookings/${booking.id}`, tenantToken);
    const body = after.json().booking;
    expect(body.status).toBe("CONFIRMED");
    expect(body.confirmedAt).not.toBeNull();
    expect(body.listing.masked).toBe(false);
    expect(body.listing.actualName).toBe("ReadTest Real Name");
    expect(body.payment.status).toBe("CAPTURED");
    expect(body.payment.online.status).toBe("CAPTURED");
    expect(body.payment.online.capturedAt).not.toBeNull();
  });

  it("GET /v1/bookings returns only the caller's own bookings", async () => {
    // otherTenant has made no bookings yet (the tenant fixture owns the others),
    // so this list must contain exactly the one booking we create here.
    const bed = await freshBed("LIST");
    const otherBooking = await bookingService.createBookingHold(otherTenant.id, { bedId: bed.id });

    const res = await get(`/v1/bookings?limit=50`, otherToken);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(otherBooking.id);
  });

  it("a non-TENANT role is rejected with 403", async () => {
    const bed = await freshBed("ROLE");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    const res = await get(`/v1/bookings/${booking.id}`, hostToken);
    expect(res.statusCode).toBe(403);
  });

  it("an unauthenticated read is rejected with 401", async () => {
    const res = await get(`/v1/bookings/${randomUUID()}`);
    expect(res.statusCode).toBe(401);
  });
});
