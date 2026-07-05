import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { invoiceDeliverer } from "../../lib/invoice-delivery.js";
import { agentCommissionPaise, computeInvoiceBreakdown, netCommissionPaise } from "./erp.engine.js";
import type { Invoice, InvoiceListResponse, InvoiceSendResult } from "@roomadda/shared";

/**
 * ERP-3 Invoice Center (§15.6/§15.7) end-to-end against a live Postgres. Proves:
 * the customer invoice's pro-rata equals the ERP-1 engine's; the commission
 * invoice's net equals the engine net formula; an edit updates the balance
 * without altering any engine-owned figure; the PDF renders (%PDF); send / bulk /
 * mark-sent are audited; and WhatsApp delivery goes through the STUBBED seam
 * (no live BSP key needed). AGENT_COMMISSION_BPS default = 1000 (10%).
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;

// Concrete money for the "== engine" assertions.
const RENT = 3_000_000; // ₹30,000
const DEPOSIT = 2_000_000; // ₹20,000
const TOKEN = 1_000_000; // ₹10,000
const ONLINE = 1_000_000; // captured online
const CASH = 500_000; // collected cash
const COLLECTED = ONLINE + CASH; // 1,500,000
const MOVE_IN = new Date(Date.UTC(2026, 5, 15)); // 15 Jun 2026 (June: 30 days)

const breakdown = computeInvoiceBreakdown({
  monthlyRentPaise: RENT,
  depositPaise: DEPOSIT,
  tokenAmountPaise: TOKEN,
  moveIn: MOVE_IN,
});
const EXPECTED_PRORATA = breakdown.proRataFirstMonthRentPaise!;
const EXPECTED_COMMISSION = agentCommissionPaise(RENT, BPS);
const EXPECTED_NET = netCommissionPaise({ commissionPaise: EXPECTED_COMMISSION, paidToPgPaise: 0, collectedPaise: COLLECTED });

describe("erp-3 invoice center (§15.6/§15.7, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let host: User;
  let tenant: User;
  let agent: User;
  let property: PgListing;
  let adminToken: string;
  let agentToken: string;
  let cust1: Booking; // the primary confirmed-paid booking
  let cust2: Booking; // a second confirmed-paid booking (for bulk send)

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];

  const mkBooking = async (rentPaise: number): Promise<Booking> => {
    const room = await prisma.room.create({
      data: { listingId: property.id, name: `R-${randomUUID().slice(0, 6)}`, sharingType: 2, monthlyRentPaise: rentPaise, depositPaise: 0 },
    });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: "BOOKED" } });
    const booking = await prisma.booking.create({
      data: {
        bedId: bed.id,
        tenantId: tenant.id,
        listingId: property.id,
        status: "CONFIRMED",
        tokenAmountPaise: TOKEN,
        monthlyRentPaise: rentPaise,
        depositPaise: DEPOSIT,
        moveInDate: MOVE_IN,
        bookedByAgentId: agent.id,
        agentChannel: "ASSISTED",
        confirmedAt: new Date(),
      },
    });
    bookingIds.push(booking.id);
    return booking;
  };

  const addMoney = async (booking: Booking): Promise<void> => {
    const payment = await prisma.payment.create({
      data: { bookingId: booking.id, amountPaise: ONLINE, status: "CAPTURED", method: "RAZORPAY", razorpayOrderId: `order_${randomUUID().slice(0, 12)}` },
    });
    await prisma.paymentTransaction.create({
      data: { paymentId: payment.id, amountPaise: ONLINE, status: "CAPTURED", method: "RAZORPAY", razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}`, capturedAt: new Date() },
    });
    await prisma.cashCollection.create({
      data: { bookingId: booking.id, agentId: agent.id, amountPaise: CASH, status: "COLLECTED", collectedAt: new Date() },
    });
  };

  const reviewInvoice = async (bookingId: string, type: "CUSTOMER" | "COMMISSION"): Promise<Invoice> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/invoices/${bookingId}?type=${type}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return (res.json() as { invoice: Invoice }).invoice;
  };
  const lineOf = (inv: Invoice, code: string) => inv.lineItems.find((l) => l.code === code)!;

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP3 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya PgOwner", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Ravi Tenant", role: "TENANT", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, agent.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agent.id, role: "AGENT" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP3-Nest-${randomUUID().slice(0, 6)}`, areaLabel: "Indiranagar", city: "Bengaluru", actualName: "Nest PG", fullAddress: "2 Road", pincode: "560038", latitude: 12.97, longitude: 77.64, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    cust1 = await mkBooking(RENT);
    await addMoney(cust1);
    cust2 = await mkBooking(RENT);
    await addMoney(cust2);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.commissionLedger.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.cashCollection.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { bookingId: { in: bookingIds } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it("CUSTOMER invoice: deposit + pro-rata (== engine) + maintenance/electricity; total/paid/balance", async () => {
    const inv = await reviewInvoice(cust1.id, "CUSTOMER");
    expect(inv.type).toBe("CUSTOMER");
    expect(inv.recipient.name).toBe("Ravi Tenant");
    expect(inv.recipient.phone).toBe(tenant.phone);

    // Deposit + pro-rata come straight from the engine (never recomputed here).
    expect(lineOf(inv, "DEPOSIT").amountPaise).toBe(DEPOSIT);
    expect(lineOf(inv, "PRO_RATA_RENT").amountPaise).toBe(EXPECTED_PRORATA);
    expect(lineOf(inv, "PRO_RATA_RENT").source).toBe("ENGINE");
    // Non-derivable manual lines default to 0 before any edit.
    expect(lineOf(inv, "MAINTENANCE").amountPaise).toBe(0);
    expect(lineOf(inv, "ELECTRICITY").amountPaise).toBe(0);

    // Total = deposit + pro-rata (+ 0 manual); paid = engine-collected; balance = total − paid.
    expect(inv.totalPaise).toBe(DEPOSIT + EXPECTED_PRORATA);
    expect(inv.paidPaise).toBe(COLLECTED);
    expect(inv.balancePaise).toBe(DEPOSIT + EXPECTED_PRORATA - COLLECTED);
    expect(inv.status).toBe("DRAFT");
  });

  it("COMMISSION invoice: net == engine net formula; recipient is the PG owner", async () => {
    const inv = await reviewInvoice(cust1.id, "COMMISSION");
    expect(inv.type).toBe("COMMISSION");
    expect(inv.recipient.name).toBe("Priya PgOwner"); // the host / PG owner
    expect(inv.recipient.phone).toBe(host.phone);

    expect(lineOf(inv, "COMMISSION").amountPaise).toBe(EXPECTED_COMMISSION);
    expect(lineOf(inv, "COLLECTED").amountPaise).toBe(COLLECTED);
    expect(lineOf(inv, "NET").amountPaise).toBe(EXPECTED_NET);
    // The net position IS the total (signed — negative means RoomAdda owes the owner).
    expect(inv.totalPaise).toBe(EXPECTED_NET);
    expect(EXPECTED_NET).toBeLessThan(0); // sanity: collected > commission here
    // Pending settlement → nothing settled, whole net outstanding.
    expect(inv.paidPaise).toBe(0);
    expect(inv.balancePaise).toBe(EXPECTED_NET);
  });

  it("edit updates the balance WITHOUT altering any engine-owned figure (audited)", async () => {
    const before = await reviewInvoice(cust1.id, "CUSTOMER");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/erp/invoices/${cust1.id}?type=CUSTOMER`,
      headers: auth(adminToken),
      payload: { maintenancePaise: 50_000, electricityPaise: 30_000, paidPaise: 1_800_000 },
    });
    expect(res.statusCode).toBe(200);
    const after = (res.json() as { invoice: Invoice }).invoice;

    // The manual lines + amount-paid changed…
    expect(lineOf(after, "MAINTENANCE").amountPaise).toBe(50_000);
    expect(lineOf(after, "ELECTRICITY").amountPaise).toBe(30_000);
    expect(after.paidPaise).toBe(1_800_000);
    // …the balance recomputed live…
    expect(after.totalPaise).toBe(DEPOSIT + EXPECTED_PRORATA + 50_000 + 30_000);
    expect(after.balancePaise).toBe(after.totalPaise - 1_800_000);
    // …but the ENGINE-owned deposit + pro-rata are byte-for-byte unchanged.
    expect(lineOf(after, "DEPOSIT").amountPaise).toBe(lineOf(before, "DEPOSIT").amountPaise);
    expect(lineOf(after, "PRO_RATA_RENT").amountPaise).toBe(lineOf(before, "PRO_RATA_RENT").amountPaise);
    expect(lineOf(after, "PRO_RATA_RENT").amountPaise).toBe(EXPECTED_PRORATA);

    // Re-reading from scratch confirms the engine figures survive persistence.
    const reread = await reviewInvoice(cust1.id, "CUSTOMER");
    expect(lineOf(reread, "PRO_RATA_RENT").amountPaise).toBe(EXPECTED_PRORATA);
    expect(reread.paidPaise).toBe(1_800_000); // override persisted

    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.invoice.updated", targetId: cust1.id } });
    expect(audit).not.toBeNull();
  });

  it("a COMMISSION invoice cannot be edited (engine-owned)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/erp/invoices/${cust1.id}?type=COMMISSION`,
      headers: auth(adminToken),
      payload: { paidPaise: 999 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVOICE_NOT_EDITABLE");
  });

  it("generates a PDF for each invoice type (%PDF)", async () => {
    for (const type of ["CUSTOMER", "COMMISSION"] as const) {
      const res = await app.inject({ method: "GET", url: `/v1/erp/invoices/${cust1.id}/pdf?type=${type}`, headers: auth(adminToken) });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.rawPayload.subarray(0, 4).toString("utf8")).toBe("%PDF");
    }
  });

  it("sends ONE customer invoice over the stubbed WhatsApp seam (audited)", async () => {
    const spy = vi.spyOn(invoiceDeliverer, "sendInvoice").mockResolvedValue();
    const res = await app.inject({ method: "POST", url: `/v1/erp/invoices/${cust2.id}/send?type=CUSTOMER`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const inv = (res.json() as { invoice: Invoice }).invoice;
    expect(inv.status).toBe("SENT");
    expect(inv.sentAt).not.toBeNull();

    // Delivery went through the interface — the "customer" campaign, real PDF bytes.
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0]![0];
    expect(msg.campaign).toBe("customer");
    expect(msg.invoiceType).toBe("CUSTOMER");
    expect(msg.toPhone).toBe(tenant.phone);
    expect(Buffer.from(msg.pdf).subarray(0, 4).toString("utf8")).toBe("%PDF");

    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.invoice.sent", targetId: cust2.id } });
    expect(audit).not.toBeNull();
    spy.mockRestore();
  });

  it("'Comm' generates + sends the COMMISSION invoice to the PG owner (pgowner campaign)", async () => {
    const spy = vi.spyOn(invoiceDeliverer, "sendInvoice").mockResolvedValue();
    const res = await app.inject({ method: "POST", url: `/v1/erp/invoices/${cust2.id}/comm`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const inv = (res.json() as { invoice: Invoice }).invoice;
    expect(inv.type).toBe("COMMISSION");
    expect(inv.status).toBe("SENT");

    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0]![0];
    expect(msg.campaign).toBe("pgowner");
    expect(msg.invoiceType).toBe("COMMISSION");
    expect(msg.toPhone).toBe(host.phone); // the PG owner
    expect(Buffer.from(msg.pdf).subarray(0, 4).toString("utf8")).toBe("%PDF");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "erp.invoice.sent", targetId: cust2.id, actorId: admin.id, metadata: { path: ["type"], equals: "COMMISSION" } },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { campaign?: string }).campaign).toBe("pgowner");
    spy.mockRestore();
  });

  it("mark-sent flips status WITHOUT re-delivering (audited)", async () => {
    const spy = vi.spyOn(invoiceDeliverer, "sendInvoice").mockResolvedValue();
    const res = await app.inject({ method: "POST", url: `/v1/erp/invoices/${cust1.id}/mark-sent?type=CUSTOMER`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { invoice: Invoice }).invoice.status).toBe("SENT");
    expect(spy).not.toHaveBeenCalled(); // marked, not re-sent
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.invoice.marked_sent", targetId: cust1.id } });
    expect(audit).not.toBeNull();
    spy.mockRestore();
  });

  it("bulk-sends customer invoices through the seam, audited once", async () => {
    const spy = vi.spyOn(invoiceDeliverer, "sendInvoice").mockResolvedValue();
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/invoices/send`,
      headers: auth(adminToken),
      payload: { type: "CUSTOMER", bookingIds: [cust1.id, cust2.id] },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as InvoiceSendResult;
    expect(result.sent).toBe(2);
    expect(result.delivered).toBe(true);
    expect(result.bookingIds.sort()).toEqual([cust1.id, cust2.id].sort());
    expect(spy).toHaveBeenCalledTimes(2);
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.invoice.sent_bulk", actorId: admin.id } });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { sent?: number }).sent).toBe(2);
    spy.mockRestore();
  });

  it("lists Invoice-Center rows: recipient name + number, total, balance, sent status", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/invoices?type=CUSTOMER&limit=50`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const list = res.json() as InvoiceListResponse;
    const row = list.items.find((e) => e.bookingId === cust2.id);
    expect(row).toBeDefined();
    expect(row!.recipientName).toBe("Ravi Tenant");
    expect(row!.recipientPhone).toBe(tenant.phone);
    expect(row!.totalPaise).toBe(DEPOSIT + EXPECTED_PRORATA); // cust2 unedited
    expect(row!.status).toBe("SENT"); // sent in the bulk step

    // The commission list surfaces the PG owner as the recipient.
    const comm = await app.inject({ method: "GET", url: `/v1/erp/invoices?type=COMMISSION&limit=50`, headers: auth(adminToken) });
    const commRow = (comm.json() as InvoiceListResponse).items.find((e) => e.bookingId === cust1.id);
    expect(commRow!.recipientName).toBe("Priya PgOwner");
    expect(commRow!.totalPaise).toBe(EXPECTED_NET);
  });

  it("is ADMIN-only (an agent is denied)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/invoices?type=CUSTOMER`, headers: auth(agentToken) });
    expect(res.statusCode).toBe(403);
  });
});
