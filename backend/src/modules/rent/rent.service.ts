import { Prisma, type RentInvoice } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { razorpay } from "../../lib/razorpay.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { rentReminderNotifier } from "../../lib/rent-reminder.js";
import { toPage, type Page } from "../../lib/pagination.js";
import {
  RENT_REMINDER_WINDOWS,
  dueRentReminderWindow,
  periodKey,
  periodLabel,
  rentPeriodsToGenerate,
} from "./rent.logic.js";

/** Generate an invoice once its due date is within this window (pay-ahead). */
const RENT_GENERATE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export interface RentPayResult {
  invoiceId: string;
  amountPaise: number;
  razorpayOrder: { orderId: string; amount: number; currency: string; keyId: string };
}

export interface RentReceiptSource {
  invoiceId: string;
  tenantName: string;
  listingName: string;
  area: string;
  periodLabel: string;
  amountPaise: number;
  paymentId: string | null;
  paidAt: Date | null;
}

const invoiceNotFound = () =>
  new AppError({ statusCode: 404, code: "RENT_INVOICE_NOT_FOUND", message: "Rent invoice not found" });

export const rentService = {
  /**
   * Initiate a FULL-amount rent payment: ensure a Razorpay order exists for the
   * invoice and return it. NEVER marks the invoice PAID — only the verified
   * webhook does (see /CLAUDE.md). Ownership is enforced; a foreign/absent id is
   * 404 (never 403), so it cannot be used to probe. Reusing the stored order on
   * a retry keeps this idempotent.
   */
  async payInvoice(invoiceId: string, tenantId: string): Promise<RentPayResult> {
    const invoice = await prisma.rentInvoice.findUnique({
      where: { id: invoiceId },
      include: { booking: { select: { tenantId: true } } },
    });
    if (!invoice || invoice.booking.tenantId !== tenantId) throw invoiceNotFound();
    if (invoice.status === "PAID") {
      throw new AppError({ statusCode: 409, code: "RENT_ALREADY_PAID", message: "This rent invoice is already paid" });
    }
    assertPaise(invoice.amountPaise);
    if (invoice.amountPaise <= 0) {
      throw new AppError({ statusCode: 400, code: "RENT_NOT_PAYABLE", message: "This invoice has no payable amount" });
    }

    let orderId = invoice.razorpayOrderId;
    if (!orderId) {
      // External call stays OUT of any DB transaction.
      const order = await razorpay.createOrder(invoice.amountPaise, `rent_${invoice.id}`);
      await prisma.rentInvoice.update({ where: { id: invoice.id }, data: { razorpayOrderId: order.id } });
      orderId = order.id;
    }

    return {
      invoiceId: invoice.id,
      amountPaise: invoice.amountPaise,
      razorpayOrder: { orderId, amount: invoice.amountPaise, currency: "INR", keyId: env.RAZORPAY_KEY_ID },
    };
  },

  /** Load one invoice for its tenant (the mobile polls this after paying). 404 if foreign. */
  async getInvoiceForTenant(invoiceId: string, tenantId: string): Promise<RentInvoice> {
    const invoice = await prisma.rentInvoice.findUnique({
      where: { id: invoiceId },
      include: { booking: { select: { tenantId: true } } },
    });
    if (!invoice || invoice.booking.tenantId !== tenantId) throw invoiceNotFound();
    return invoice;
  },

  /** The caller's own rent history, newest due first, cursor-paginated. */
  async listForTenant(
    tenantId: string,
    input: { cursor?: string; limit: number },
  ): Promise<Page<RentInvoice>> {
    const rows = await prisma.rentInvoice.findMany({
      where: { booking: { tenantId } },
      orderBy: [{ dueDate: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, input.limit);
  },

  /** Data for the paid-rent PDF receipt (tenant-owned, PAID only). */
  async getReceiptData(invoiceId: string, tenantId: string): Promise<RentReceiptSource> {
    const inv = await prisma.rentInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        booking: {
          select: {
            tenantId: true,
            tenant: { select: { fullName: true } },
            listing: { select: { actualName: true, areaLabel: true, city: true } },
          },
        },
      },
    });
    if (!inv || inv.booking.tenantId !== tenantId) throw invoiceNotFound();
    if (inv.status !== "PAID") {
      throw new AppError({ statusCode: 409, code: "RENT_RECEIPT_NOT_READY", message: "Receipt is available once the rent is paid" });
    }
    return {
      invoiceId: inv.id,
      tenantName: inv.booking.tenant.fullName,
      listingName: inv.booking.listing.actualName,
      area: `${inv.booking.listing.areaLabel}, ${inv.booking.listing.city}`,
      periodLabel: periodLabel(inv.periodMonth),
      amountPaise: inv.amountPaise,
      paymentId: inv.razorpayPaymentId,
      paidAt: inv.paidAt,
    };
  },

  /**
   * Generate the next due rent invoice(s) for every active stay (CONFIRMED
   * bookings whose move-in has arrived). The token covers the first month, so
   * rent begins the following month. Idempotent: the (bookingId, periodMonth)
   * unique index makes a concurrent/duplicate run a no-op. Returns the count
   * created. Run by the BullMQ rent-billing job.
   */
  async generateDueRentInvoices(now: Date = new Date()): Promise<number> {
    const bookings = await prisma.booking.findMany({
      where: { status: "CONFIRMED", moveInDate: { not: null, lte: now } },
      select: {
        id: true,
        moveInDate: true,
        monthlyRentPaise: true,
        rentInvoices: { select: { periodMonth: true } },
      },
    });

    let created = 0;
    for (const b of bookings) {
      if (!b.moveInDate) continue;
      const existing = new Set(b.rentInvoices.map((r) => periodKey(r.periodMonth)));
      const plans = rentPeriodsToGenerate({
        moveInDate: b.moveInDate,
        monthlyRentPaise: b.monthlyRentPaise,
        existingPeriodKeys: existing,
        now,
        aheadMs: RENT_GENERATE_AHEAD_MS,
      });
      for (const p of plans) {
        try {
          await prisma.rentInvoice.create({
            data: { bookingId: b.id, periodMonth: p.periodMonth, amountPaise: p.amountPaise, dueDate: p.dueDate, status: "DUE" },
          });
          created++;
        } catch (err) {
          // A concurrent run already created this period — fine, keep going.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
          throw err;
        }
      }
    }
    return created;
  },

  /**
   * Sweep unpaid invoices past their due day to OVERDUE — a money-NEUTRAL label
   * (PAID is only ever set by the webhook). Uses the same calendar-day boundary
   * as the read path's effective status, so the stored label matches the API.
   * Idempotent; returns the number relabelled.
   */
  async markOverdueInvoices(): Promise<number> {
    return prisma.$executeRaw`
      UPDATE rent_invoices
      SET status = 'OVERDUE', "updatedAt" = now()
      WHERE status = 'DUE' AND "dueDate" < date_trunc('day', now())
    `;
  },

  /**
   * Send rent reminders for every DUE invoice whose due date is within a reminder
   * window (5 days, then 1 day before) and has not yet had that window sent. A
   * PAID/OVERDUE invoice never reminds. Idempotent and safe to re-run: the window
   * is CLAIMED with an atomic conditional update (push the key only while still
   * absent) BEFORE delivery, so concurrent ticks can never both send and a re-run
   * is a no-op. Delivery is best-effort — a send failure releases the claim so a
   * later tick retries. Returns the number actually delivered. Run by the
   * BullMQ rent-billing job AFTER the overdue sweep (so the DUE set excludes
   * past-due invoices).
   */
  async sendDueReminders(now: Date = new Date()): Promise<number> {
    const candidates = await prisma.rentInvoice.findMany({
      where: { status: "DUE" },
      select: {
        id: true,
        dueDate: true,
        periodMonth: true,
        amountPaise: true,
        remindersSent: true,
        booking: {
          select: {
            tenant: { select: { fullName: true, phone: true } },
            listing: { select: { alias: true } },
          },
        },
      },
    });

    let delivered = 0;
    for (const inv of candidates) {
      const window = dueRentReminderWindow(inv.dueDate, now, new Set(inv.remindersSent));
      if (!window) continue;

      // Idempotency barrier: claim the window first. The `NOT has` guard makes
      // this a no-op for a window already recorded (so a re-run never re-fires),
      // and atomic so two ticks can't both claim it.
      const claim = await prisma.rentInvoice.updateMany({
        where: { id: inv.id, status: "DUE", NOT: { remindersSent: { has: window } } },
        data: { remindersSent: { push: window } },
      });
      if (claim.count === 0) continue; // already claimed by another tick / run

      try {
        await rentReminderNotifier.sendRentReminder({
          toPhone: inv.booking.tenant.phone!, // a booking's tenant is a phone-OTP user
          tenantName: inv.booking.tenant.fullName,
          listingAlias: inv.booking.listing.alias,
          periodLabel: periodLabel(inv.periodMonth),
          amountPaise: inv.amountPaise,
          dueDate: inv.dueDate,
          daysBeforeDue: RENT_REMINDER_WINDOWS.find((w) => w.key === window)?.daysBefore ?? 0,
        });
        delivered += 1;
      } catch (err) {
        // Delivery failed after we claimed the window: release just this key
        // (atomic, won't clobber a concurrently-added window) so a later tick
        // retries it. Never throw — one bad reminder must not stall the sweep.
        await prisma
          .$executeRaw`UPDATE rent_invoices SET "remindersSent" = array_remove("remindersSent", ${window}) WHERE id = ${inv.id}::uuid`
          .catch(() => undefined);
        logger.error({ err, invoiceId: inv.id, window }, "rent reminder delivery failed");
      }
    }
    return delivered;
  },
};
