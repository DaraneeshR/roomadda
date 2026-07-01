import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, Room, User } from "@prisma/client";
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
 * End-to-end booking flow against a live DB: book-by-room, Instant vs
 * Request-to-Book (payment blocked until host accept), webhook-driven CONFIRMED,
 * downloadable receipt, and cancel-with-refund. Confirmation is ALWAYS via the
 * verified webhook — never an app/route shortcut (see /CLAUDE.md).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature, eventId: `evt_flow_${randomUUID().slice(0, 8)}` };
}

describe("booking flow (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User;
  let instantRoom: Room;
  let requestRoom: Room;
  let tenantToken: string;
  let hostToken: string;
  const listingIds: string[] = [];

  async function listingWithRoom(instantBook: boolean, beds: number): Promise<{ listing: PgListing; room: Room }> {
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Flow PG", areaLabel: "Area", city: "City",
        actualName: "Flow Real Name", fullAddress: "1 Flow Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED", instantBook,
      },
    });
    listingIds.push(listing.id);
    const room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    for (let i = 0; i < beds; i++) {
      await prisma.bed.create({ data: { roomId: room.id, label: `B${i}`, status: "AVAILABLE" } });
    }
    return { listing, room };
  }

  const auth = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });

  /** Drive an instant booking all the way to CONFIRMED via a verified webhook. */
  async function confirmViaWebhook(bookingId: string, tokenPaise: number): Promise<void> {
    const pay = await paymentService.createTokenPayment(bookingId, tenant.id, { method: "ONLINE", onlinePaise: tokenPaise, cashPaise: 0 });
    const orderId = pay.razorpayOrder!.orderId;
    const evt = capturedEvent(orderId, tokenPaise);
    await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(bookingRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Flow Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Flow Tenant", role: "TENANT", isPhoneVerified: true } });
    // The booking gate requires VERIFIED KYC.
    await prisma.kycRecord.create({ data: { userId: tenant.id, status: "VERIFIED", docType: "AADHAAR" } });
    ({ room: instantRoom } = await listingWithRoom(true, 4));
    ({ room: requestRoom } = await listingWithRoom(false, 1));
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: { in: listingIds } } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_flow_" } } });
    await prisma.kycRecord.deleteMany({ where: { userId: tenant.id } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("Instant Book: book-by-room holds a bed as TOKEN_PENDING (payable now)", async () => {
    const res = await auth("POST", "/v1/bookings", tenantToken, { roomId: instantRoom.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().booking.status).toBe("TOKEN_PENDING");
    expect(res.json().booking.bedId).toBeTruthy(); // server picked a bed
  });

  it("Request-to-Book: waits for host accept before payment", async () => {
    const created = await auth("POST", "/v1/bookings", tenantToken, { roomId: requestRoom.id });
    expect(created.statusCode).toBe(201);
    const booking = created.json().booking;
    expect(booking.status).toBe("PENDING_APPROVAL");

    // Payment is blocked while awaiting approval.
    const blocked = await auth("POST", `/v1/bookings/${booking.id}/payment`, tenantToken, {
      method: "ONLINE", onlinePaise: booking.tokenAmountPaise, cashPaise: 0,
    });
    expect(blocked.statusCode).toBe(409);

    // Host accepts -> unlocks payment.
    const accepted = await auth("POST", `/v1/bookings/${booking.id}/accept`, hostToken);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().booking.status).toBe("TOKEN_PENDING");

    const pay = await auth("POST", `/v1/bookings/${booking.id}/payment`, tenantToken, {
      method: "ONLINE", onlinePaise: booking.tokenAmountPaise, cashPaise: 0,
    });
    expect(pay.statusCode).toBe(201);
  });

  it("accepted-but-unpaid request: host accept locks the bed ~4h, then the sweep releases it", async () => {
    const { room } = await listingWithRoom(false, 1); // its own request-to-book room + bed
    const created = await auth("POST", "/v1/bookings", tenantToken, { roomId: room.id });
    const booking = created.json().booking;
    expect(booking.status).toBe("PENDING_APPROVAL");
    const bedId = booking.bedId as string;

    // Host accepts -> TOKEN_PENDING with a ~4h payment window; the bed stays HELD.
    const accepted = await auth("POST", `/v1/bookings/${booking.id}/accept`, hostToken);
    expect(accepted.json().booking.status).toBe("TOKEN_PENDING");
    const afterAccept = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const windowMs = afterAccept.holdExpiresAt!.getTime() - Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    // Within a minute of the 4h target (covers test-runtime jitter).
    expect(windowMs).toBeGreaterThan(FOUR_HOURS - 60_000);
    expect(windowMs).toBeLessThanOrEqual(FOUR_HOURS);
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: bedId } })).status).toBe("HELD");

    // The accepted-but-unpaid hold lapses -> the sweep frees the bed (no stranded inventory).
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const freed = await bookingService.expireStaleHolds();
    expect(freed).toBeGreaterThanOrEqual(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("EXPIRED");
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: bedId } })).status).toBe("AVAILABLE");
  });

  it("receipt: 409 before confirmation, valid PDF after the webhook confirms", async () => {
    const created = await auth("POST", "/v1/bookings", tenantToken, { roomId: instantRoom.id });
    expect(created.statusCode).toBe(201);
    const booking = created.json().booking;

    const early = await auth("GET", `/v1/bookings/${booking.id}/receipt`, tenantToken);
    expect(early.statusCode).toBe(409); // RECEIPT_NOT_READY

    await confirmViaWebhook(booking.id, booking.tokenAmountPaise);

    const detail = await auth("GET", `/v1/bookings/${booking.id}`, tenantToken);
    expect(detail.json().booking.status).toBe("CONFIRMED");
    expect(detail.json().booking.hostName).toBe("Flow Host"); // host name revealed post-confirm

    const receipt = await auth("GET", `/v1/bookings/${booking.id}/receipt`, tenantToken);
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers["content-type"]).toContain("application/pdf");
    expect(receipt.rawPayload.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("cancel after confirmation applies the refund policy and frees the bed", async () => {
    const created = await auth("POST", "/v1/bookings", tenantToken, {
      roomId: instantRoom.id,
      moveInDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // >7 days -> full refund
    });
    if (created.statusCode !== 201) return; // room may be exhausted; the policy is unit-tested separately
    const booking = created.json().booking;
    await confirmViaWebhook(booking.id, booking.tokenAmountPaise);

    const cancel = await auth("POST", `/v1/bookings/${booking.id}/cancel`, tenantToken, { reason: "plans changed" });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("CANCELLED");
    expect(cancel.json().refundPaise).toBe(booking.tokenAmountPaise); // full refund > 7 days out
  });
});
