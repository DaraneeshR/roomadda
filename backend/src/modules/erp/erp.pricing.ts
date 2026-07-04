/**
 * Shared ERP pricing (§15.5) — the ONE place that turns a confirmed-paid booking
 * into its money figures, so every ERP screen (the commission ledger, the
 * bookings ledger, the booking detail) prices the same booking identically. It
 * gathers AUTHORITATIVE amounts — captured-online (the webhook's CAPTURED payment
 * transactions) + collected-cash (COLLECTED/RECONCILED CashCollection) + the
 * ERP-owned `paidToPg` — and combines them through the money engine. It never
 * re-derives money the webhook already owns; it only reads and sums it.
 */
import type { Booking } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { computeLedgerFigures } from "./erp.engine.js";

/**
 * The bookings that carry commission: a booking earns commission only once it is
 * CONFIRMED (settlement proved the token was fully paid) or COMPLETED (which was
 * CONFIRMED first). Everything else is NEVER priced — the "confirmed-paid only"
 * guarantee shared by every ERP screen.
 */
export const LEDGER_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED"] as const;
export type LedgerBookingStatus = (typeof LEDGER_BOOKING_STATUSES)[number];

/** The engine-priced money + ERP-owned settlement state for one booking. */
export interface BookingMoney {
  commissionPaise: number;
  paidToPgPaise: number;
  collectedPaise: number;
  netPaise: number;
  settlementStatus: "PENDING" | "RECEIVED";
  receivedAt: Date | null;
}

/** The minimum a booking must carry to be priced. */
export type PriceableBooking = Pick<Booking, "id" | "monthlyRentPaise">;

/**
 * Price a set of bookings, returning a `bookingId → {@link BookingMoney}` map.
 * `commission` = BPS of the booking's monthly rent; `collected` = captured-online
 * + collected-cash; `net` = commission + paidToPg − collected — all from the one
 * money engine. Callers pass ONLY confirmed-paid bookings; an empty input is a
 * no-op (no DB round-trips). The map omits nothing that was passed in.
 */
export async function priceBookings(bookings: PriceableBooking[]): Promise<Map<string, BookingMoney>> {
  const out = new Map<string, BookingMoney>();
  if (bookings.length === 0) return out;

  const bookingIds = bookings.map((b) => b.id);

  // Payments are 1:1 with a booking; captured-online is the sum of that payment's
  // CAPTURED transactions (the webhook-owned money — never recomputed, only read).
  const [payments, cashGroups, ledgerRows] = await Promise.all([
    prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true, bookingId: true } }),
    prisma.cashCollection.groupBy({
      by: ["bookingId"],
      where: { bookingId: { in: bookingIds }, status: { in: ["COLLECTED", "RECONCILED"] } },
      _sum: { amountPaise: true },
    }),
    prisma.commissionLedger.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { bookingId: true, paidToPgPaise: true, status: true, receivedAt: true },
    }),
  ]);

  const paymentToBooking = new Map(payments.map((p) => [p.id, p.bookingId]));
  const onlineByBooking = new Map<string, number>();
  if (payments.length > 0) {
    const capturedGroups = await prisma.paymentTransaction.groupBy({
      by: ["paymentId"],
      where: { paymentId: { in: payments.map((p) => p.id) }, status: "CAPTURED" },
      _sum: { amountPaise: true },
    });
    for (const g of capturedGroups) {
      const bookingId = paymentToBooking.get(g.paymentId);
      if (!bookingId) continue;
      onlineByBooking.set(bookingId, (onlineByBooking.get(bookingId) ?? 0) + (g._sum.amountPaise ?? 0));
    }
  }

  const cashByBooking = new Map(cashGroups.map((g) => [g.bookingId, g._sum.amountPaise ?? 0]));
  const ledgerByBooking = new Map(ledgerRows.map((l) => [l.bookingId, l]));

  for (const booking of bookings) {
    const ledger = ledgerByBooking.get(booking.id);
    const paidToPgPaise = ledger?.paidToPgPaise ?? 0;
    const collectedPaise = (onlineByBooking.get(booking.id) ?? 0) + (cashByBooking.get(booking.id) ?? 0);
    const { commissionPaise, netPaise } = computeLedgerFigures({
      monthlyRentPaise: booking.monthlyRentPaise,
      bps: env.AGENT_COMMISSION_BPS,
      paidToPgPaise,
      collectedPaise,
    });
    out.set(booking.id, {
      commissionPaise,
      paidToPgPaise,
      collectedPaise,
      netPaise,
      settlementStatus: ledger?.status ?? "PENDING",
      receivedAt: ledger?.receivedAt ?? null,
    });
  }
  return out;
}
