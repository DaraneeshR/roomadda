import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HotelRoomCategory, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { invoiceTotalFromBookingsPaise } from "@roomadda/shared";
import { hotelService } from "../hotel/hotel.service.js";
import { webhookService } from "../booking/webhook.service.js";
import { resolveCompanyContext, type CompanyContext } from "./corporate.access.js";
import { corporateEnquiryService } from "./corporate.enquiry.service.js";
import { corporateQuotationService } from "./corporate.quotation.service.js";
import { corporateBookingService } from "./corporate.booking.service.js";
import { corporateInvoiceService } from "./corporate.invoice.service.js";
import { corporateCompanyService } from "./corporate.company.service.js";
import { corporateDirectoryService } from "./corporate.directory.service.js";
import { corporateEmployeeService } from "./corporate.employee.js";

/**
 * C1 — corporate B2B flow proofs (live DB). enquiry → quotation → negotiate →
 * accept → corporate booking (draws corporate inventory via the H0 guard) →
 * employee allocation → company invoice. Money is engine-sourced; an online invoice
 * is PAID (and a PREPAY booking CONFIRMED) ONLY by the verified webhook; employee
 * privacy holds throughout.
 */

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const EVT = "evt_corp_";

/** A signed payment.captured webhook (raw body + valid signature). */
function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

const UNIT_PRICE = 400_000; // paise/night

describe("corporate flow (integration)", () => {
  let host: User;
  let admin: User;
  const city = `Corp-${randomUUID().slice(0, 8)}`;
  const listingIds: string[] = [];
  const companyIds: string[] = [];
  const userIds: string[] = [];

  async function makeHotel(alias: string, corporateReservedRooms: number): Promise<{ listing: PgListing; category: HotelRoomCategory }> {
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias, areaLabel: "Corp Area", city,
        actualName: `${alias} Real`, fullAddress: "1 Corp Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
        propertyType: "HOTEL", visibility: "CORPORATE_ONLY",
      },
    });
    listingIds.push(listing.id);
    const category = await prisma.hotelRoomCategory.create({
      data: { listingId: listing.id, tier: `Tier-${randomUUID().slice(0, 6)}`, perNightPaise: UNIT_PRICE, totalRooms: corporateReservedRooms, corporateReservedRooms },
    });
    await hotelService.provisionUnits(category.id); // materialises the CORPORATE units
    return { listing, category };
  }

  /** Create a company + an ADMIN HR seat (a fresh consumer login). Returns the ctx. */
  async function makeCompany(billingMode: "PREPAY" | "CREDIT"): Promise<{ companyId: string; ctx: CompanyContext; seatUser: User }> {
    const company = await corporateCompanyService.createCompany(admin.id, { name: `Co ${randomUUID().slice(0, 6)}`, billingMode, creditDays: 30 });
    companyIds.push(company.id);
    const seatUser = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "HR Admin", role: "TENANT", isPhoneVerified: true } });
    userIds.push(seatUser.id);
    await prisma.companyUser.create({ data: { companyId: company.id, userId: seatUser.id, role: "ADMIN" } });
    const ctx = await resolveCompanyContext(seatUser.id);
    return { companyId: company.id, ctx, seatUser };
  }

  beforeAll(async () => {
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } });
    userIds.push(host.id, admin.id);
  });

  afterAll(async () => {
    await prisma.employeeAllocation.deleteMany({ where: { corporateBooking: { companyId: { in: companyIds } } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: EVT } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // ---- 1. Quotation revision preserves history (no overwrite) -------------
  it("negotiating appends a revision — earlier revisions are never overwritten", async () => {
    const { ctx } = await makeCompany("PREPAY");
    const { category } = await makeHotel("Hist Hotel", 2);
    const enquiry = await corporateEnquiryService.createEnquiry(ctx.companyId /* actor stand-in */, ctx, {
      city, area: null, propertyType: "HOTEL", headcount: 1, checkIn: day("2027-03-01"), checkOut: day("2027-03-04"), notes: null,
    });

    const q1 = await corporateQuotationService.buildQuotation(admin.id, {
      enquiryId: enquiry.id, taxPaise: 0,
      lineItems: [{ categoryId: category.id, description: "Deluxe x1", unitPricePaise: UNIT_PRICE, quantity: 1, nights: 3 }],
    });
    expect(q1.revisions).toHaveLength(1);
    expect(q1.revisions[0]!.totalPaise).toBe(UNIT_PRICE * 3); // 1,200,000

    await corporateQuotationService.sendQuotation(admin.id, q1.id);
    await corporateQuotationService.respond(ctx.companyId, ctx, q1.id, { action: "REQUEST_CHANGES", note: "cheaper please" });

    // A NEW price → a NEW revision. History is preserved.
    const q2 = await corporateQuotationService.addRevision(admin.id, q1.id, {
      taxPaise: 0,
      lineItems: [{ categoryId: category.id, description: "Deluxe x1 (revised)", unitPricePaise: 350_000, quantity: 1, nights: 3 }],
    });
    expect(q2.currentRevision).toBe(2);
    expect(q2.revisions).toHaveLength(2);
    // Revision 1 is byte-for-byte unchanged; revision 2 carries the new total.
    expect(q2.revisions[0]!.revision).toBe(1);
    expect(q2.revisions[0]!.totalPaise).toBe(UNIT_PRICE * 3);
    expect(q2.revisions[1]!.revision).toBe(2);
    expect(q2.revisions[1]!.totalPaise).toBe(350_000 * 3);
  });

  // ---- 2+3+4. Accept → book (draws corp inventory) → invoice==engine →
  //             online payment CONFIRMED only via webhook -------------------
  it("accepted quotation books corporate inventory; invoice==engine; webhook (not callback) confirms", async () => {
    const { ctx } = await makeCompany("PREPAY");
    const { listing, category } = await makeHotel("Flow Hotel", 1); // ONE corporate unit
    const enquiry = await corporateEnquiryService.createEnquiry(ctx.companyId, ctx, {
      city, area: null, propertyType: "HOTEL", headcount: 1, checkIn: day("2027-04-01"), checkOut: day("2027-04-04"), notes: null,
    });
    const q = await corporateQuotationService.buildQuotation(admin.id, {
      enquiryId: enquiry.id, taxPaise: 0,
      lineItems: [{ categoryId: category.id, description: "Suite x1", unitPricePaise: UNIT_PRICE, quantity: 1, nights: 3 }],
    });
    await corporateQuotationService.sendQuotation(admin.id, q.id);
    await corporateQuotationService.respond(ctx.companyId, ctx, q.id, { action: "ACCEPT" });

    // Convert → CorporateBooking drawing the CORPORATE unit (channel CORPORATE).
    const booking = await corporateBookingService.convertQuotation(admin.id, q.id);
    expect(booking.status).toBe("PENDING");
    expect(booking.totalPaise).toBe(UNIT_PRICE * 3);
    const reservations = await prisma.hotelReservation.findMany({ where: { corporateBookingId: booking.id } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.channel).toBe("CORPORATE");
    expect(reservations[0]!.listingId).toBe(listing.id);

    // Employee allocation.
    const empUser = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Employee One", role: "TENANT", isPhoneVerified: true } });
    userIds.push(empUser.id);
    const emp = await corporateDirectoryService.createEmployee(ctx.companyId, ctx, { fullName: "Employee One", phone: empUser.phone! });
    await corporateBookingService.allocateEmployee(ctx.companyId, ctx, booking.id, { employeeId: emp.id, hotelReservationId: reservations[0]!.id });

    // Generate the company invoice — amount is ENGINE-sourced.
    const invoice = await corporateInvoiceService.generateInvoice(admin.id, booking.id);
    expect(invoice.totalPaise).toBe(invoiceTotalFromBookingsPaise([UNIT_PRICE * 3]));
    expect(invoice.status).toBe("DUE");
    expect(invoice.billingMode).toBe("PREPAY");

    // Initiate ONLINE payment — the callback returns an order but confirms NOTHING.
    const pay = await corporateInvoiceService.createPaymentOrder(ctx, invoice.id);
    expect(pay.amountPaise).toBe(UNIT_PRICE * 3);
    let inv = await prisma.corporateInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    let bk = await prisma.corporateBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(inv.status).toBe("DUE"); // NOT paid by the callback
    expect(bk.status).toBe("PENDING"); // NOT confirmed by the callback

    // A partial capture must NOT settle.
    const partial = capturedEvent(pay.razorpayOrder.orderId, UNIT_PRICE * 3 - 1);
    await webhookService.processRazorpay(partial.raw, partial.signature, `${EVT}partial_${randomUUID()}`);
    inv = await prisma.corporateInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(inv.status).toBe("DUE");

    // The FULL verified webhook settles the invoice AND confirms the PREPAY booking.
    const full = capturedEvent(pay.razorpayOrder.orderId, UNIT_PRICE * 3);
    const eventId = `${EVT}full_${randomUUID()}`;
    const res = await webhookService.processRazorpay(full.raw, full.signature, eventId);
    expect(res.status).toBe("processed");

    inv = await prisma.corporateInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    bk = await prisma.corporateBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(inv.status).toBe("PAID");
    expect(inv.paidPaise).toBe(UNIT_PRICE * 3);
    expect(inv.razorpayPaymentId).not.toBeNull();
    expect(bk.status).toBe("CONFIRMED");
    const confirmedRes = await prisma.hotelReservation.findFirstOrThrow({ where: { corporateBookingId: booking.id } });
    expect(confirmedRes.status).toBe("CONFIRMED");
    expect(confirmedRes.qrCodeToken).toMatch(/^cqr_/);

    // Replay is idempotent.
    const replay = await webhookService.processRazorpay(full.raw, full.signature, eventId);
    expect(replay.status).toBe("duplicate");

    // ---- 5. Employee privacy: sees the stay + QR, NEVER the negotiated money.
    const stays = await corporateEmployeeService.listMyStays(empUser.id);
    expect(stays).toHaveLength(1);
    expect(stays[0]!.reservationStatus).toBe("CONFIRMED");
    expect(stays[0]!.qrCodeToken).toMatch(/^cqr_/);
    const serialized = JSON.stringify(stays[0]);
    expect(serialized).not.toContain(String(UNIT_PRICE * 3)); // no negotiated total
    expect(serialized.toLowerCase()).not.toContain("paise");
  });

  // ---- 2b. Overbooking guard rejects an overlapping corporate draw --------
  it("a second corporate booking on the only unit over overlapping dates is rejected (guard)", async () => {
    const { ctx } = await makeCompany("PREPAY");
    const { category } = await makeHotel("Guard Hotel", 1); // ONE corporate unit

    async function acceptedQuotationFor(checkIn: string, checkOut: string): Promise<string> {
      const enq = await corporateEnquiryService.createEnquiry(ctx.companyId, ctx, {
        city, area: null, propertyType: "HOTEL", headcount: 1, checkIn: day(checkIn), checkOut: day(checkOut), notes: null,
      });
      const quote = await corporateQuotationService.buildQuotation(admin.id, {
        enquiryId: enq.id, taxPaise: 0,
        lineItems: [{ categoryId: category.id, description: "x1", unitPricePaise: UNIT_PRICE, quantity: 1, nights: 3 }],
      });
      await corporateQuotationService.sendQuotation(admin.id, quote.id);
      await corporateQuotationService.respond(ctx.companyId, ctx, quote.id, { action: "ACCEPT" });
      return quote.id;
    }

    const first = await acceptedQuotationFor("2027-05-01", "2027-05-04");
    const second = await acceptedQuotationFor("2027-05-03", "2027-05-06"); // overlaps

    await corporateBookingService.convertQuotation(admin.id, first); // draws the single unit
    // The second draw finds no free CORPORATE unit for the overlapping range — the
    // H0 guard + row-locked allocation make an overlapping double-book impossible.
    await expect(corporateBookingService.convertQuotation(admin.id, second)).rejects.toMatchObject({
      code: "NO_CORPORATE_AVAILABILITY",
    });
  });

  // ---- CREDIT: manual confirm + OFFLINE settle (audited) ------------------
  it("CREDIT booking is CRM-confirmed and its post-stay invoice is settled offline (audited)", async () => {
    const { ctx } = await makeCompany("CREDIT");
    const { category } = await makeHotel("Credit Hotel", 1);
    const enq = await corporateEnquiryService.createEnquiry(ctx.companyId, ctx, {
      city, area: null, propertyType: "HOTEL", headcount: 1, checkIn: day("2027-07-01"), checkOut: day("2027-07-03"), notes: null,
    });
    const quote = await corporateQuotationService.buildQuotation(admin.id, {
      enquiryId: enq.id, taxPaise: 0,
      lineItems: [{ categoryId: category.id, description: "x1", unitPricePaise: UNIT_PRICE, quantity: 1, nights: 2 }],
    });
    await corporateQuotationService.sendQuotation(admin.id, quote.id);
    await corporateQuotationService.respond(ctx.companyId, ctx, quote.id, { action: "ACCEPT" });
    const booking = await corporateBookingService.convertQuotation(admin.id, quote.id);

    // CREDIT: admin manually confirms (MVP CRM path) — reservations CONFIRMED before the stay.
    const confirmed = await corporateBookingService.confirmBooking(admin.id, booking.id);
    expect(confirmed.status).toBe("CONFIRMED");

    // Post-stay invoice: DUE with a credit due date (issue + 30d).
    const invoice = await corporateInvoiceService.generateInvoice(admin.id, booking.id);
    expect(invoice.status).toBe("DUE");
    expect(invoice.dueDate).not.toBeNull();
    expect(new Date(invoice.dueDate!).getTime()).toBeGreaterThan(new Date(invoice.issuedAt!).getTime());

    // Settle OFFLINE (bank transfer) — admin-marked, audited.
    const settled = await corporateInvoiceService.settleOffline(admin.id, invoice.id, { settlementRef: "NEFT-REF-123" });
    expect(settled.status).toBe("PAID");
    expect(settled.paidPaise).toBe(UNIT_PRICE * 2);

    const audit = await prisma.auditLog.findFirst({ where: { action: "corporate.invoice.settled_offline", targetId: invoice.id } });
    expect(audit).not.toBeNull();
  });

  // ---- Cross-company scoping (hard boundary) ------------------------------
  it("a company context cannot read another company's quotation (404)", async () => {
    const a = await makeCompany("PREPAY");
    const b = await makeCompany("PREPAY");
    const { category } = await makeHotel("Scope Hotel", 1);
    const enq = await corporateEnquiryService.createEnquiry(a.ctx.companyId, a.ctx, {
      city, area: null, propertyType: "HOTEL", headcount: 1, checkIn: day("2027-08-01"), checkOut: day("2027-08-03"), notes: null,
    });
    const quote = await corporateQuotationService.buildQuotation(admin.id, {
      enquiryId: enq.id, taxPaise: 0,
      lineItems: [{ categoryId: category.id, description: "x1", unitPricePaise: UNIT_PRICE, quantity: 1, nights: 2 }],
    });
    // Company B must not see company A's quotation.
    await expect(corporateQuotationService.getById(quote.id, b.ctx)).rejects.toThrow();
    // Company A can.
    const seen = await corporateQuotationService.getById(quote.id, a.ctx);
    expect(seen.id).toBe(quote.id);
  });
});
