/**
 * Shared §15.3 finance gathering — the ONE engine-priced confirmed-paid booking
 * set that the dashboard, the money manager, and the agents leaderboard all roll
 * up. It applies the §15.3 global filter (FY/quarter/month via the resolved
 * period, plus optional property/agent) exactly as the commission ledger does,
 * loads the same authoritative rows, and prices each booking through the ONE money
 * engine (via {@link priceBookings}). Because every ERP-4 surface reads THIS set,
 * no headline can disagree with the ledger — and a reassignment (which just moves
 * `bookedByAgentId`) is reflected everywhere on the next read, with no separate
 * commission path. Pure data-gathering; no serialization, no auth (route-enforced).
 */
import type { Booking, Prisma } from "@prisma/client";
import type { AgentBookingChannel } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import type { FinancialPeriod } from "./erp.engine.js";
import { LEDGER_BOOKING_STATUSES, priceBookings, type BookingMoney } from "./erp.pricing.js";

/** The §15.3 property/agent scoping (the FY/quarter/month is already resolved to a period). */
export interface FinanceScope {
  listingId?: string;
  agentId?: string;
}

/** One confirmed-paid booking, engine-priced, with the display fields the three
 *  finance surfaces group / label by. */
export interface FinanceBooking {
  id: string;
  listingId: string;
  listingAlias: string;
  tenantId: string;
  tenantName: string;
  agentId: string | null;
  agentName: string | null;
  agentChannel: AgentBookingChannel | null;
  confirmedAt: Date | null;
  monthlyRentPaise: number;
  // Snapshot amounts for the CA pack's customer-invoice breakdown (engine-priced
  // via computeInvoiceBreakdown). Present on every booking row.
  depositPaise: number;
  tokenAmountPaise: number;
  moveInDate: Date | null;
  money: BookingMoney;
}

/** The booking columns + relations the finance roll-ups need. */
const financeInclude = {
  tenant: { select: { fullName: true } },
  listing: { select: { alias: true } },
  bookedByAgent: { select: { fullName: true } },
} satisfies Prisma.BookingInclude;

type FinanceRow = Prisma.BookingGetPayload<{ include: typeof financeInclude }>;

/**
 * Gather the confirmed-paid bookings inside the resolved period (bounded by
 * `confirmedAt` — the same lens the commission ledger uses), optionally scoped to
 * one property and/or one agent, each priced through the money engine. The result
 * is THE filtered set every ERP-4 headline is a Σ of.
 */
export async function gatherConfirmedPaidBookings(
  scope: FinanceScope,
  period: FinancialPeriod,
): Promise<FinanceBooking[]> {
  const where: Prisma.BookingWhereInput = {
    status: { in: [...LEDGER_BOOKING_STATUSES] },
    confirmedAt: { gte: period.fromInclusive, lt: period.toExclusive },
    ...(scope.listingId ? { listingId: scope.listingId } : {}),
    ...(scope.agentId ? { bookedByAgentId: scope.agentId } : {}),
  };

  const rows = await prisma.booking.findMany({ where, include: financeInclude });
  const money = await priceBookings(rows);
  return rows.map((row) => toFinanceBooking(row, money.get(row.id)!));
}

function toFinanceBooking(row: FinanceRow, money: BookingMoney): FinanceBooking {
  return {
    id: row.id,
    listingId: row.listingId,
    listingAlias: row.listing.alias,
    tenantId: row.tenantId,
    tenantName: row.tenant.fullName,
    agentId: row.bookedByAgentId,
    agentName: row.bookedByAgent?.fullName ?? null,
    agentChannel: row.agentChannel,
    confirmedAt: row.confirmedAt,
    monthlyRentPaise: row.monthlyRentPaise,
    depositPaise: row.depositPaise,
    tokenAmountPaise: row.tokenAmountPaise,
    moveInDate: row.moveInDate,
    money,
  };
}

/** The minimal booking shape {@link priceBookings} needs — re-exported so callers
 *  that already hold a Booking row can price it without importing pricing directly. */
export type { Booking };
