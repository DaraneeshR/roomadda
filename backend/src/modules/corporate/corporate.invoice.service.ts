import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { razorpay } from "../../lib/razorpay.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { invoiceDueDate, invoiceTotalFromBookingsPaise } from "@roomadda/shared";
import type { CorporateInvoice as CorporateInvoiceDto, CorporatePaymentResponse } from "@roomadda/shared";
import type { SettleInvoiceOfflineInput } from "./corporate.schema.js";
import { assertSameCompany, type CompanyContext } from "./corporate.access.js";
import { toInvoice } from "./corporate.serializer.js";
import { applyInvoicePaidTx } from "./corporate.invoice.payment.js";

const invoiceNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "CORPORATE_INVOICE_NOT_FOUND", message: "Corporate invoice not found" });

export const corporateInvoiceService = {
  /**
   * ADMIN/CRM: generate the company invoice for a corporate booking. Total is
   * ENGINE-sourced (invoiceTotalFromBookingsPaise over the booking total) — never
   * recomputed from rooms×price here. `billingMode` + `dueDate` come from the
   * company terms (PREPAY due now; CREDIT due issue+creditDays). One invoice per
   * booking. Audited.
   */
  async generateInvoice(actorId: string, bookingId: string): Promise<CorporateInvoiceDto> {
    const booking = await prisma.corporateBooking.findUnique({
      where: { id: bookingId },
      select: { id: true, companyId: true, totalPaise: true, company: { select: { billingMode: true, creditDays: true } } },
    });
    if (!booking) throw new AppError({ statusCode: 404, code: "CORPORATE_BOOKING_NOT_FOUND", message: "Corporate booking not found" });

    const existing = await prisma.corporateInvoice.findFirst({ where: { corporateBookingId: bookingId }, select: { id: true } });
    if (existing) throw new AppError({ statusCode: 409, code: "INVOICE_EXISTS", message: "An invoice already exists for this booking" });

    const totalPaise = invoiceTotalFromBookingsPaise([booking.totalPaise]);
    assertPaise(totalPaise);
    const issuedAt = new Date();
    const dueDate = invoiceDueDate(booking.company.billingMode, issuedAt, booking.company.creditDays);

    const invoice = await prisma.corporateInvoice.create({
      data: {
        companyId: booking.companyId,
        corporateBookingId: booking.id,
        billingMode: booking.company.billingMode,
        status: "DUE",
        totalPaise,
        paidPaise: 0,
        issuedAt,
        dueDate,
      },
    });
    await writeAudit({ actorId, action: "corporate.invoice.generated", targetId: invoice.id, metadata: { bookingId, totalPaise, billingMode: booking.company.billingMode } });
    return toInvoice(invoice);
  },

  /**
   * COMPANY: initiate ONLINE payment of an own-company invoice — returns a
   * server-side Razorpay order for the outstanding balance. NEVER marks the invoice
   * paid; settlement happens ONLY via the verified webhook (money rule #2). The
   * amount is server-owned (never taken from the client).
   */
  async createPaymentOrder(ctx: CompanyContext, invoiceId: string): Promise<CorporatePaymentResponse> {
    const invoice = await prisma.corporateInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw invoiceNotFound();
    assertSameCompany(invoice.companyId, ctx);
    if (invoice.status === "PAID") {
      throw new AppError({ statusCode: 409, code: "INVOICE_ALREADY_PAID", message: "This invoice is already paid" });
    }
    if (invoice.razorpayOrderId) {
      throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
    }
    const balancePaise = invoice.totalPaise - invoice.paidPaise;
    assertPaise(balancePaise);
    if (balancePaise <= 0) {
      throw new AppError({ statusCode: 409, code: "NOTHING_DUE", message: "This invoice has no outstanding balance" });
    }

    // External call BEFORE the guarded write (never hold a tx open across I/O).
    const order = await razorpay.createOrder(balancePaise, `corp_inv_${invoice.id}`);
    try {
      const updated = await prisma.corporateInvoice.updateMany({
        where: { id: invoice.id, razorpayOrderId: null, status: { not: "PAID" } },
        data: { razorpayOrderId: order.id },
      });
      if (updated.count === 0) {
        throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
      }
      throw err;
    }

    return {
      invoiceId: invoice.id,
      amountPaise: balancePaise,
      razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  },

  /**
   * ADMIN: settle an invoice OFFLINE (bank transfer / cheque). Marks it PAID with the
   * settlement reference (audited). Uses the SAME settle core as the webhook, so a
   * PREPAY booking confirms here too — but this path is admin-driven, never a client
   * self-confirm of an online payment.
   */
  async settleOffline(actorId: string, invoiceId: string, input: SettleInvoiceOfflineInput): Promise<CorporateInvoiceDto> {
    const invoice = await prisma.corporateInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw invoiceNotFound();
    if (invoice.status === "PAID") {
      throw new AppError({ statusCode: 409, code: "INVOICE_ALREADY_PAID", message: "This invoice is already paid" });
    }
    const settled = await prisma.$transaction(async (tx) => {
      await applyInvoicePaidTx(tx, invoice, { settledById: actorId, settlementRef: input.settlementRef });
      return tx.corporateInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    await writeAudit({ actorId, action: "corporate.invoice.settled_offline", targetId: invoiceId, metadata: { settlementRef: input.settlementRef } });
    return toInvoice(settled);
  },

  async getById(id: string, ctx?: CompanyContext): Promise<CorporateInvoiceDto> {
    const invoice = await prisma.corporateInvoice.findUnique({ where: { id } });
    if (!invoice) throw invoiceNotFound();
    if (ctx) assertSameCompany(invoice.companyId, ctx);
    return toInvoice(invoice);
  },

  async listForCompany(ctx: CompanyContext, input: { cursor?: string; limit: number }): Promise<Page<CorporateInvoiceDto>> {
    return listInvoices({ companyId: ctx.companyId, ...input });
  },

  /** ADMIN (finance): corporate invoices across all companies (optional filter). */
  async listAll(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<CorporateInvoiceDto>> {
    return listInvoices(input);
  },
};

async function listInvoices(input: { companyId?: string; cursor?: string; limit: number }): Promise<Page<CorporateInvoiceDto>> {
  const rows = await prisma.corporateInvoice.findMany({
    where: input.companyId ? { companyId: input.companyId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = toPage(rows, input.limit);
  return { items: page.items.map(toInvoice), nextCursor: page.nextCursor };
}
