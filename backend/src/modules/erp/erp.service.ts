import type { Booking, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { assertPaise } from "../../lib/money.js";
import { resolveFinancialPeriod, type FinancialPeriod } from "./erp.engine.js";
import { LEDGER_BOOKING_STATUSES, priceBookings, type BookingMoney } from "./erp.pricing.js";
import type {
  CommissionLedgerEntry,
  CommissionLedgerResponse,
  CommissionLedgerTotals,
  ErpCommissionQuery,
  MarkCommissionReceivedInput,
  MarkCommissionReceivedResult,
} from "@roomadda/shared";

interface Actor {
  id: string;
}

/** Everything the money engine needs for one booking, gathered from authoritative rows. */
interface LedgerRow {
  booking: Pick<
    Booking,
    "id" | "listingId" | "bookedByAgentId" | "agentChannel" | "status" | "confirmedAt" | "monthlyRentPaise"
  >;
  money: BookingMoney;
  listingAlias: string;
  agentName: string | null;
}

export const erpService = {
  /**
   * The per-booking commission ledger (§15.5), filtered by the §15.3 global
   * finance filter (FY / quarter / month / property / agent) and paginated. Every
   * figure is produced by the money engine from AUTHORITATIVE rows: `commission`
   * is BPS of the booking's rent, `collected` is captured-online + collected-cash
   * (the same authoritative aggregation the webhook settlement uses — never
   * recomputed here). Totals cover the WHOLE filtered set, not just the page, so a
   * headline can never disagree with the rows beneath it.
   */
  async commissionLedger(query: ErpCommissionQuery, now: Date = new Date()): Promise<CommissionLedgerResponse> {
    const period = resolveFinancialPeriod(query, now);
    const rows = await gatherLedgerRows(query, period);

    // Optional settlement-status filter (received vs pending) applied uniformly to
    // both the rows and the totals below.
    const filtered =
      query.status === undefined ? rows : rows.filter((r) => r.money.settlementStatus === query.status);

    const entries = filtered
      .map(toEntry)
      // Most-recently-settled first; bookingId as a stable tiebreaker for cursoring.
      .sort((a, b) => {
        const at = a.confirmedAt ?? "";
        const bt = b.confirmedAt ?? "";
        if (at !== bt) return at < bt ? 1 : -1;
        return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
      });

    const totals = totalsOf(entries);
    const { items, nextCursor } = paginate(entries, query.cursor, query.limit);

    return {
      items,
      nextCursor,
      totals,
      period: serializePeriod(period),
    };
  },

  /**
   * Mark ONE booking's commission received (§15.5), optionally recording the
   * payout made to the PG owner (`paidToPgPaise`) at the same time. Creates the
   * ledger row lazily, is idempotent (re-marking is a no-op re-write), and is
   * audited. Only a confirmed-paid booking can be settled.
   */
  async markReceived(
    actor: Actor,
    bookingId: string,
    input: MarkCommissionReceivedInput,
    ip?: string,
  ): Promise<CommissionLedgerEntry> {
    await assertLedgerBooking(bookingId);
    if (input.paidToPgPaise !== undefined) assertPaise(input.paidToPgPaise);

    await prisma.commissionLedger.upsert({
      where: { bookingId },
      create: {
        bookingId,
        status: "RECEIVED",
        receivedAt: now(),
        receivedById: actor.id,
        ...(input.paidToPgPaise !== undefined ? { paidToPgPaise: input.paidToPgPaise } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      update: {
        status: "RECEIVED",
        receivedAt: now(),
        receivedById: actor.id,
        ...(input.paidToPgPaise !== undefined ? { paidToPgPaise: input.paidToPgPaise } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });

    await writeAudit({
      actorId: actor.id,
      action: "erp.commission.received",
      targetId: bookingId,
      ip,
      metadata: {
        ...(input.paidToPgPaise !== undefined ? { paidToPgPaise: input.paidToPgPaise } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });

    return toEntry(await gatherOneLedgerRow(bookingId));
  },

  /**
   * Bulk mark several bookings' commission received. Only confirmed-paid bookings
   * in the list are settled (others are silently skipped). Runs in a single
   * transaction (multi-row mutation) and writes ONE audit record listing exactly
   * which bookings were settled.
   */
  async markReceivedBulk(
    actor: Actor,
    bookingIds: string[],
    ip?: string,
  ): Promise<MarkCommissionReceivedResult> {
    const eligible = await prisma.booking.findMany({
      where: { id: { in: bookingIds }, status: { in: [...LEDGER_BOOKING_STATUSES] } },
      select: { id: true },
    });
    const eligibleIds = eligible.map((b) => b.id);

    if (eligibleIds.length > 0) {
      const at = now();
      await prisma.$transaction(
        eligibleIds.map((bookingId) =>
          prisma.commissionLedger.upsert({
            where: { bookingId },
            create: { bookingId, status: "RECEIVED", receivedAt: at, receivedById: actor.id },
            update: { status: "RECEIVED", receivedAt: at, receivedById: actor.id },
          }),
        ),
      );
    }

    await writeAudit({
      actorId: actor.id,
      action: "erp.commission.received_bulk",
      ip,
      metadata: { requested: bookingIds.length, settled: eligibleIds.length, bookingIds: eligibleIds },
    });

    return { updated: eligibleIds.length, bookingIds: eligibleIds };
  },
};

// ---------------------------------------------------------------------------
// Internal helpers — the authoritative-row gathering and the engine plumbing.
// ---------------------------------------------------------------------------

function now(): Date {
  return new Date();
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });

/** A booking must exist AND be confirmed-paid before its commission can be settled. */
async function assertLedgerBooking(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) throw notFound();
  if (!LEDGER_BOOKING_STATUSES.includes(booking.status as (typeof LEDGER_BOOKING_STATUSES)[number])) {
    throw new AppError({
      statusCode: 409,
      code: "BOOKING_NOT_CONFIRMED",
      message: "Only a confirmed-paid booking has commission to settle",
    });
  }
}

/** The booking columns the engine + serializer need. */
const bookingSelect = {
  id: true,
  listingId: true,
  bookedByAgentId: true,
  agentChannel: true,
  status: true,
  confirmedAt: true,
  monthlyRentPaise: true,
} as const;

/** Load the full filtered set of confirmed-paid bookings and everything the engine
 *  needs to price each one. Bounded by the resolved finance period. */
async function gatherLedgerRows(query: ErpCommissionQuery, period: FinancialPeriod): Promise<LedgerRow[]> {
  const where: Prisma.BookingWhereInput = {
    status: { in: [...LEDGER_BOOKING_STATUSES] },
    confirmedAt: { gte: period.fromInclusive, lt: period.toExclusive },
    ...(query.listingId ? { listingId: query.listingId } : {}),
    ...(query.agentId ? { bookedByAgentId: query.agentId } : {}),
  };

  const bookings = await prisma.booking.findMany({ where, select: bookingSelect });
  return hydrateRows(bookings);
}

/** Same hydration for a single booking (used after a settlement write). */
async function gatherOneLedgerRow(bookingId: string): Promise<LedgerRow> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: bookingSelect });
  if (!booking) throw notFound();
  const [row] = await hydrateRows([booking]);
  if (!row) throw notFound();
  return row;
}

type BookingCore = Pick<
  Booking,
  "id" | "listingId" | "bookedByAgentId" | "agentChannel" | "status" | "confirmedAt" | "monthlyRentPaise"
>;

/**
 * Attach to each booking its money figures (via the shared {@link priceBookings}
 * — the identical pricing every ERP screen uses) plus the display fields (listing
 * alias, agent name) the commission ledger shows.
 */
async function hydrateRows(bookings: BookingCore[]): Promise<LedgerRow[]> {
  if (bookings.length === 0) return [];
  const listingIds = [...new Set(bookings.map((b) => b.listingId))];
  const agentIds = [...new Set(bookings.map((b) => b.bookedByAgentId).filter((id): id is string => id !== null))];

  const [money, listings, agents] = await Promise.all([
    priceBookings(bookings),
    prisma.pgListing.findMany({ where: { id: { in: listingIds } }, select: { id: true, alias: true } }),
    agentIds.length
      ? prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, fullName: true } })
      : Promise.resolve([]),
  ]);

  const aliasByListing = new Map(listings.map((l) => [l.id, l.alias]));
  const nameByAgent = new Map(agents.map((a) => [a.id, a.fullName]));

  return bookings.map((booking) => ({
    booking,
    money: money.get(booking.id)!,
    listingAlias: aliasByListing.get(booking.listingId) ?? "",
    agentName: booking.bookedByAgentId ? (nameByAgent.get(booking.bookedByAgentId) ?? null) : null,
  }));
}

/** Turn one gathered row into the wire DTO, using the engine-priced figures. */
function toEntry(row: LedgerRow): CommissionLedgerEntry {
  return {
    bookingId: row.booking.id,
    listingId: row.booking.listingId,
    listingAlias: row.listingAlias,
    agentId: row.booking.bookedByAgentId,
    agentName: row.agentName,
    agentChannel: row.booking.agentChannel,
    bookingStatus: row.booking.status,
    confirmedAt: row.booking.confirmedAt?.toISOString() ?? null,
    monthlyRentPaise: row.booking.monthlyRentPaise,
    commissionPaise: row.money.commissionPaise,
    paidToPgPaise: row.money.paidToPgPaise,
    collectedPaise: row.money.collectedPaise,
    netPaise: row.money.netPaise,
    status: row.money.settlementStatus,
    receivedAt: row.money.receivedAt?.toISOString() ?? null,
  };
}

/** Roll up a set of already-priced entries. Sums equal Σ of the row figures. */
function totalsOf(entries: CommissionLedgerEntry[]): CommissionLedgerTotals {
  const t: CommissionLedgerTotals = {
    bookingCount: entries.length,
    receivedCount: 0,
    pendingCount: 0,
    commissionPaise: 0,
    paidToPgPaise: 0,
    collectedPaise: 0,
    netPaise: 0,
    receivedNetPaise: 0,
    pendingNetPaise: 0,
  };
  for (const e of entries) {
    t.commissionPaise += e.commissionPaise;
    t.paidToPgPaise += e.paidToPgPaise;
    t.collectedPaise += e.collectedPaise;
    t.netPaise += e.netPaise;
    if (e.status === "RECEIVED") {
      t.receivedCount += 1;
      t.receivedNetPaise += e.netPaise;
    } else {
      t.pendingCount += 1;
      t.pendingNetPaise += e.netPaise;
    }
  }
  return t;
}

/** In-memory cursor pagination over the sorted entries (cursor = bookingId). */
function paginate(
  entries: CommissionLedgerEntry[],
  cursor: string | undefined,
  limit: number,
): { items: CommissionLedgerEntry[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const idx = entries.findIndex((e) => e.bookingId === cursor);
    start = idx >= 0 ? idx + 1 : entries.length;
  }
  const slice = entries.slice(start, start + limit + 1);
  if (slice.length > limit) {
    const items = slice.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: last ? last.bookingId : null };
  }
  return { items: slice, nextCursor: null };
}

function serializePeriod(period: FinancialPeriod) {
  return {
    financialYear: period.financialYear,
    label: period.label,
    fromInclusive: period.fromInclusive.toISOString(),
    toExclusive: period.toExclusive.toISOString(),
  };
}
