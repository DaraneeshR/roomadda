import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { signAccessToken } from "../../lib/tokens.js";
import { razorpay } from "../../lib/razorpay.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { bookingRoutes } from "../booking/booking.route.js";
import { paymentService } from "../booking/payment.service.js";
import { webhookService } from "../booking/webhook.service.js";

/**
 * Cancellation + refunds, end-to-end against a live DB. The load-bearing claim:
 * a refund is INITIATED by /cancel but settles to a refunded state ONLY via the
 * signature-verified `refund.processed` webhook — never from the synchronous
 * refund API response (see /CLAUDE.md domain rule #2). Mirrors the payment
 * webhook test for the confirm path.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;

function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature, eventId: `evt_rcancel_${randomUUID().slice(0, 8)}` };
}

function refundEvent(
  refundId: string,
  eventType: "refund.processed" | "refund.failed",
  eventId = `evt_rcancel_${randomUUID().slice(0, 8)}`,
) {
  const body = JSON.stringify({
    event: eventType,
    payload: { refund: { entity: { id: refundId, payment_id: "pay_x", amount: 0, status: eventType.split(".")[1] } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature, eventId };
}

describe("cancellation + refund (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User;
  let otherTenant: User;
  let listing: PgListing;
  let room: Room;
  let tenantToken: string;
  let otherTenantToken: string;
  let hostToken: string;

  const auth = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });

  const freshBed = () =>
    prisma.bed.create({ data: { roomId: room.id, label: `RB-${randomUUID().slice(0, 8)}`, status: "AVAILABLE" } });

  /** Book a specific bed and drive it to CONFIRMED via the verified webhook. */
  async function confirmedBooking(bedId: string, moveInOffsetDays: number) {
    const created = await auth("POST", "/v1/bookings", tenantToken, {
      bedId,
      moveInDate: new Date(Date.now() + moveInOffsetDays * DAY_MS).toISOString(),
    });
    expect(created.statusCode).toBe(201);
    const booking = created.json().booking;
    const pay = await paymentService.createTokenPayment(booking.id, tenant.id, {
      method: "ONLINE",
      onlinePaise: booking.tokenAmountPaise,
      cashPaise: 0,
    });
    const evt = capturedEvent(pay.razorpayOrder!.orderId, booking.tokenAmountPaise);
    await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    const confirmed = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(confirmed?.status).toBe("CONFIRMED");
    return booking as { id: string; tokenAmountPaise: number; bedId: string };
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(bookingRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Refund Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Refund Tenant", role: "TENANT", isPhoneVerified: true } });
    otherTenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Other Tenant", role: "TENANT", isPhoneVerified: true } });
    await prisma.kycRecord.create({ data: { userId: tenant.id, status: "VERIFIED", docType: "AADHAAR" } });
    await prisma.kycRecord.create({ data: { userId: otherTenant.id, status: "VERIFIED", docType: "AADHAAR" } });

    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Refund PG", areaLabel: "Area", city: "City",
        actualName: "Refund Real Name", fullAddress: "1 Refund Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED", instantBook: true,
      },
    });
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    otherTenantToken = await signAccessToken({ sub: otherTenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await prisma.refundTransaction.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
    await prisma.room.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_rcancel_" } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: [tenant.id, otherTenant.id] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [tenant.id, host.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, otherTenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("cancel > 7 days out -> FULL refund initiated, bed freed, NOT yet settled", async () => {
    const refundSpy = vi.spyOn(razorpay, "refund");
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 30);

    const res = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken, { reason: "plans changed" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "CANCELLED",
      refundPaise: booking.tokenAmountPaise,
      refundReason: "full_refund_window",
      refundStatus: "PENDING", // never "refunded" here
    });

    // The gateway WAS called, once, for the full amount against the captured payment.
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy.mock.calls[0]![1]).toBe(booking.tokenAmountPaise);

    // The booking is CANCELLED with the snapshot; the bed is back to AVAILABLE.
    const cancelled = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.refundPaise).toBe(booking.tokenAmountPaise);
    expect(cancelled?.cancelledBy).toBe("TENANT");
    const freedBed = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(freedBed?.status).toBe("AVAILABLE");

    // CRITICAL: the synchronous API response did NOT settle anything.
    const rt = await prisma.refundTransaction.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(rt.status).toBe("INITIATED");
    expect(rt.amountPaise).toBe(booking.tokenAmountPaise);
    expect(rt.razorpayRefundId).toBeTruthy();
    expect(rt.processedAt).toBeNull();
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe("CAPTURED"); // NOT REFUNDED until the webhook

    // Now the signed refund.processed webhook settles it — the ONLY path that does.
    const evt = refundEvent(rt.razorpayRefundId!, "refund.processed");
    const out = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    expect(out.status).toBe("processed");

    const settled = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: rt.id } });
    expect(settled.status).toBe("PROCESSED");
    expect(settled.processedAt).not.toBeNull();
    expect(settled.webhookEventId).toBeTruthy();
    const refundedPayment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refundedPayment.status).toBe("REFUNDED"); // full refund settled -> payment REFUNDED

    // An audit row was written for the cancellation (actor = tenant).
    const audit = await prisma.auditLog.findFirst({ where: { action: "booking.cancelled", targetId: booking.id } });
    expect(audit?.actorId).toBe(tenant.id);
  });

  it("cancel 3–7 days out -> 50% refund initiated", async () => {
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 5);

    const res = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      refundPaise: booking.tokenAmountPaise / 2,
      refundReason: "partial_refund_window",
      refundStatus: "PENDING",
    });

    const rt = await prisma.refundTransaction.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(rt.amountPaise).toBe(booking.tokenAmountPaise / 2);
    expect(rt.status).toBe("INITIATED");
  });

  it("cancel < 3 days out -> CANCELLED, ZERO refund, NO Razorpay call, NO refund row", async () => {
    const refundSpy = vi.spyOn(razorpay, "refund");
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 1);

    const res = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "CANCELLED", refundPaise: 0, refundReason: "no_refund_window", refundStatus: "NONE" });

    expect(refundSpy).not.toHaveBeenCalled(); // no refund initiated at the gateway
    const rows = await prisma.refundTransaction.count({ where: { bookingId: booking.id } });
    expect(rows).toBe(0);
    const freedBed = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(freedBed?.status).toBe("AVAILABLE");
  });

  it("replaying refund.processed does not double-process", async () => {
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 30);
    await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    const rt = await prisma.refundTransaction.findFirstOrThrow({ where: { bookingId: booking.id } });

    // Same event id twice -> second is a duplicate (WebhookEvent unique).
    const evt = refundEvent(rt.razorpayRefundId!, "refund.processed");
    const first = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    const replay = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    expect(first.status).toBe("processed");
    expect(replay.status).toBe("duplicate");

    // A DIFFERENT event id for the same already-settled refund is a no-op ("ignored").
    const evt2 = refundEvent(rt.razorpayRefundId!, "refund.processed");
    const again = await webhookService.processRazorpay(evt2.raw, evt2.signature, evt2.eventId);
    expect(again.status).toBe("ignored");

    const settled = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: rt.id } });
    expect(settled.status).toBe("PROCESSED");
    // Settled exactly once -> exactly one webhook is linked to it.
    const linkedEvents = await prisma.webhookEvent.count({
      where: { eventType: "refund.processed", refundTransactions: { some: { id: rt.id } } },
    });
    expect(linkedEvents).toBe(1);
  });

  it("refund.failed flags the refund FAILED (admin reconcile), booking stays CANCELLED", async () => {
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 30);
    await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    const rt = await prisma.refundTransaction.findFirstOrThrow({ where: { bookingId: booking.id } });

    const evt = refundEvent(rt.razorpayRefundId!, "refund.failed");
    const out = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    expect(out.status).toBe("processed");

    const failed = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: rt.id } });
    expect(failed.status).toBe("FAILED");
    const stillCancelled = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stillCancelled?.status).toBe("CANCELLED");
    const flag = await prisma.auditLog.findFirst({ where: { action: "refund.failed", targetId: booking.id } });
    expect(flag).not.toBeNull();
  });

  it("a wrong-tenant cancel is 404 (existence never leaked)", async () => {
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 30);
    const res = await auth("POST", `/v1/bookings/${booking.id}/cancel`, otherTenantToken);
    expect(res.statusCode).toBe(404);
    const intact = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(intact?.status).toBe("CONFIRMED"); // untouched
  });

  it("cancelling a non-cancellable (already CANCELLED) booking is 409", async () => {
    const bed = await freshBed();
    const booking = await confirmedBooking(bed.id, 30);
    const first = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    expect(first.statusCode).toBe(200);
    const second = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("BOOKING_NOT_CANCELLABLE");
  });

  it("host decline routes through the same service -> FULL refund even inside the no-refund window", async () => {
    const bed = await freshBed();
    // Move-in tomorrow: a TENANT cancel here would refund 0; a HOST decline is full.
    const booking = await confirmedBooking(bed.id, 1);

    const res = await auth("POST", `/v1/bookings/${booking.id}/decline`, hostToken, { reason: "pg unavailable" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "CANCELLED",
      refundPaise: booking.tokenAmountPaise,
      refundReason: "host_cancelled",
      refundStatus: "PENDING",
    });

    const cancelled = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(cancelled?.cancelledBy).toBe("HOST");
    const rt = await prisma.refundTransaction.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(rt.amountPaise).toBe(booking.tokenAmountPaise);
    expect(rt.status).toBe("INITIATED");
  });
});
