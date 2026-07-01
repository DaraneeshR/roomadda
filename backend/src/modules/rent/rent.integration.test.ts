import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, RentInvoice, RentInvoiceStatus, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { rentRoutes } from "./rent.route.js";
import { rentService } from "./rent.service.js";
import { webhookService } from "../booking/webhook.service.js";

/**
 * Recurring-rent flow against a live DB. RENT IS MONEY: an invoice becomes PAID
 * ONLY through the signature-verified Razorpay webhook — never the /pay endpoint
 * or any client callback (see /CLAUDE.md). Also proves: a partial capture is
 * rejected, overdue is computed correctly, generation creates the next invoice,
 * and the paid receipt is a real PDF.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;

/** A signed `payment.captured` webhook for an order, mirroring Razorpay's shape. */
function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature, eventId: `evt_rent_${randomUUID().slice(0, 8)}` };
}

describe("recurring rent flow (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User;
  let otherTenant: User;
  let listing: PgListing;
  let room: Room;
  let booking: Booking; // tenant's confirmed stay (manual invoices attach here)
  let tenantToken: string;
  let otherToken: string;
  let hostToken: string;
  const listingIds: string[] = [];

  // Distinct billing months per manual invoice (unique [bookingId, periodMonth]).
  let periodSeq = 0;
  function createInvoice(opts: { bookingId: string; amountPaise: number; dueDate: Date; status?: RentInvoiceStatus }): Promise<RentInvoice> {
    periodSeq++;
    // Far-future months so they never collide with generated periods.
    const periodMonth = new Date(Date.UTC(2030, periodSeq, 1));
    return prisma.rentInvoice.create({
      data: {
        bookingId: opts.bookingId,
        periodMonth,
        amountPaise: opts.amountPaise,
        dueDate: opts.dueDate,
        status: opts.status ?? "DUE",
      },
    });
  }

  async function confirmedBooking(tenantId: string, moveInDate: Date | null): Promise<Booking> {
    const bed = await prisma.bed.create({
      data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: "BOOKED" },
    });
    return prisma.booking.create({
      data: {
        bedId: bed.id, tenantId, listingId: listing.id, status: "CONFIRMED",
        tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
        moveInDate, confirmedAt: new Date(),
      },
    });
  }

  const auth = (method: "GET" | "POST", url: string, token: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(rentRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Rent Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Rent Tenant", role: "TENANT", isPhoneVerified: true } });
    otherTenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Other Tenant", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Rent PG", areaLabel: "Area", city: "City",
        actualName: "Rent Real Name", fullAddress: "1 Rent Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    listingIds.push(listing.id);
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 },
    });
    // Main booking has NO move-in date so the generator never adds invoices to it
    // (keeps the manual-invoice tests deterministic). Ownership still applies.
    booking = await confirmedBooking(tenant.id, null);

    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    otherToken = await signAccessToken({ sub: otherTenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.rentInvoice.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_rent_" } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, otherTenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("the /pay endpoint never confirms — only the verified webhook flips DUE -> PAID", async () => {
    const invoice = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() + 5 * DAY_MS) });

    // Pay: get a full-amount order. The invoice MUST still be DUE afterwards.
    const pay = await auth("POST", `/v1/rent/${invoice.id}/pay`, tenantToken);
    expect(pay.statusCode).toBe(201);
    const order = pay.json().razorpayOrder;
    expect(order.orderId).toBeTruthy();
    expect(pay.json().amountPaise).toBe(1_200_000);

    const stillDue = await auth("GET", `/v1/rent/${invoice.id}`, tenantToken);
    expect(stillDue.json().invoice.status).toBe("DUE"); // app-side pay did NOT confirm

    // The verified webhook (full amount) is the ONLY thing that pays it.
    const evt = capturedEvent(order.orderId, 1_200_000);
    const result = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    expect(result.status).toBe("processed");

    const paid = await auth("GET", `/v1/rent/${invoice.id}`, tenantToken);
    expect(paid.json().invoice.status).toBe("PAID");
    expect(paid.json().invoice.paidAt).not.toBeNull();
  });

  it("rejects a PARTIAL capture — the invoice stays unpaid until paid in full", async () => {
    const invoice = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() + 5 * DAY_MS) });
    const order = (await auth("POST", `/v1/rent/${invoice.id}/pay`, tenantToken)).json().razorpayOrder;

    // A short capture must NOT pay the invoice.
    const partial = capturedEvent(order.orderId, 1_199_999);
    await webhookService.processRazorpay(partial.raw, partial.signature, partial.eventId);
    const afterPartial = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
    expect(afterPartial?.status).toBe("DUE");
    expect(afterPartial?.paidAt).toBeNull();

    // A later FULL capture on the same order does pay it.
    const full = capturedEvent(order.orderId, 1_200_000);
    await webhookService.processRazorpay(full.raw, full.signature, full.eventId);
    const afterFull = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
    expect(afterFull?.status).toBe("PAID");
  });

  it("computes OVERDUE with the correct day count for an unpaid past-due invoice", async () => {
    const overdue = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() - 5 * DAY_MS) });
    const future = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() + 5 * DAY_MS) });

    const o = (await auth("GET", `/v1/rent/${overdue.id}`, tenantToken)).json().invoice;
    expect(o.status).toBe("OVERDUE");
    expect(o.daysOverdue).toBe(5);

    const f = (await auth("GET", `/v1/rent/${future.id}`, tenantToken)).json().invoice;
    expect(f.status).toBe("DUE");
    expect(f.daysOverdue).toBe(0);
  });

  it("the paid-rent receipt is a real PDF; 409 before the invoice is paid", async () => {
    const invoice = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() + 5 * DAY_MS) });

    const early = await auth("GET", `/v1/rent/${invoice.id}/receipt`, tenantToken);
    expect(early.statusCode).toBe(409); // RENT_RECEIPT_NOT_READY

    const order = (await auth("POST", `/v1/rent/${invoice.id}/pay`, tenantToken)).json().razorpayOrder;
    const evt = capturedEvent(order.orderId, 1_200_000);
    await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);

    const receipt = await auth("GET", `/v1/rent/${invoice.id}/receipt`, tenantToken);
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers["content-type"]).toContain("application/pdf");
    expect(receipt.rawPayload.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("the generator creates the next invoice for an active stay, idempotently", async () => {
    const genBooking = await confirmedBooking(tenant.id, new Date(Date.now() - 40 * DAY_MS));
    const now = new Date();

    await rentService.generateDueRentInvoices(now);
    const first = await prisma.rentInvoice.findMany({ where: { bookingId: genBooking.id } });
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first[0]?.amountPaise).toBe(1_200_000);
    expect(first[0]?.status).toBe("DUE");

    // Re-running does not double-bill the same period.
    await rentService.generateDueRentInvoices(now);
    const second = await prisma.rentInvoice.findMany({ where: { bookingId: genBooking.id } });
    expect(second.length).toBe(first.length);
  });

  it("GET /v1/rent returns only the caller's invoices", async () => {
    const otherBooking = await confirmedBooking(otherTenant.id, null);
    await createInvoice({ bookingId: otherBooking.id, amountPaise: 999_999, dueDate: new Date(Date.now() + 5 * DAY_MS) });

    const res = await auth("GET", "/v1/rent?limit=50", otherToken);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ bookingId: string }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => i.bookingId === otherBooking.id)).toBe(true);
  });

  it("rejects a non-TENANT role (403) and an unauthenticated caller (401)", async () => {
    const invoice = await createInvoice({ bookingId: booking.id, amountPaise: 1_200_000, dueDate: new Date(Date.now() + 5 * DAY_MS) });
    expect((await auth("GET", `/v1/rent/${invoice.id}`, hostToken)).statusCode).toBe(403);
    const unauth = await app.inject({ method: "GET", url: `/v1/rent/${invoice.id}` });
    expect(unauth.statusCode).toBe(401);
  });
});
