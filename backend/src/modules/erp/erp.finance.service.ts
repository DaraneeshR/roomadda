/**
 * ERP-4 Dashboard + Money Manager (§15.3). Both are pure roll-ups of the SAME
 * engine-priced confirmed-paid booking set ({@link gatherConfirmedPaidBookings}),
 * scoped by the ONE §15.3 global filter, so every headline is a Σ of the ledger's
 * own per-booking figures and can never disagree with it. Nothing here recomputes
 * money — it only sums the engine-priced amounts. ADMIN-only (route-enforced).
 */
import {
  enumerateMonths,
  monthKeyOf,
  resolveFinancialPeriod,
  type FinancialPeriod,
} from "./erp.engine.js";
import { gatherConfirmedPaidBookings, type FinanceBooking } from "./erp.finance.js";
import type {
  ErpDashboardResponse,
  ErpFinanceFilter,
  ErpFinancePeriod,
  ErpMoneyManagerResponse,
  ErpMoneyMonth,
} from "@roomadda/shared";

/** How many agents the dashboard's mini leaderboard shows. */
const TOP_AGENTS_LIMIT = 5;

/** The flagged AMC gap — no annual-contract model exists yet, so AMC is never fabricated. */
const AMC_NOTE =
  "AMC (Annual Maintenance Contract) revenue is not yet modelled — there is no annual-contract entity to source it from, so it is reported as a known gap rather than a fabricated figure.";

export const erpFinanceService = {
  /**
   * The §15.3 dashboard: headline numbers, a commission-by-property chart, a
   * bookings-by-month chart, and a top-agents mini leaderboard — every figure a Σ
   * over the filtered confirmed-paid set, so it reconciles to the commission
   * ledger for the same filter. AMC is surfaced as the flagged gap, never faked.
   */
  async dashboard(filter: ErpFinanceFilter, now: Date = new Date()): Promise<ErpDashboardResponse> {
    const period = resolveFinancialPeriod(filter, now);
    const bookings = await gatherConfirmedPaidBookings(filter, period);

    return {
      period: serializePeriod(period),
      headline: buildHeadline(bookings),
      commissionByProperty: commissionByProperty(bookings),
      bookingsByMonth: bookingsByMonth(bookings, period),
      topAgents: topAgents(bookings, TOP_AGENTS_LIMIT),
      generatedAt: now.toISOString(),
    };
  },

  /**
   * The Money Manager: a month-by-month view (collection, commission, payouts,
   * settlements, running balance) plus a customer-level drill-down of who paid
   * what. Every month in the period appears (zero-filled) so the running balance
   * is continuous; the totals equal the dashboard headline sums for the same filter.
   */
  async moneyManager(filter: ErpFinanceFilter, now: Date = new Date()): Promise<ErpMoneyManagerResponse> {
    const period = resolveFinancialPeriod(filter, now);
    const bookings = await gatherConfirmedPaidBookings(filter, period);

    const months = monthlyRows(bookings, period);
    const totals = totalsOf(months);

    return {
      period: serializePeriod(period),
      months,
      totals,
      customers: customerDrilldown(bookings),
      generatedAt: now.toISOString(),
    };
  },
};

// ---------------------------------------------------------------------------
// Internal roll-up helpers. Each is a pure Σ over the engine-priced set.
// ---------------------------------------------------------------------------

function buildHeadline(bookings: FinanceBooking[]): ErpDashboardResponse["headline"] {
  const h = {
    bookingCount: bookings.length,
    netCommissionPaise: 0,
    totalCollectionPaise: 0,
    commissionPaise: 0,
    paidToPgPaise: 0,
    pendingNetPaise: 0,
    pendingBookingCount: 0,
    receivedNetPaise: 0,
    receivedBookingCount: 0,
    amc: { supported: false as const, paise: null, note: AMC_NOTE },
  };
  for (const b of bookings) {
    h.netCommissionPaise += b.money.netPaise;
    h.totalCollectionPaise += b.money.collectedPaise;
    h.commissionPaise += b.money.commissionPaise;
    h.paidToPgPaise += b.money.paidToPgPaise;
    if (b.money.settlementStatus === "RECEIVED") {
      h.receivedBookingCount += 1;
      h.receivedNetPaise += b.money.netPaise;
    } else {
      h.pendingBookingCount += 1;
      h.pendingNetPaise += b.money.netPaise;
    }
  }
  return h;
}

function commissionByProperty(bookings: FinanceBooking[]): ErpDashboardResponse["commissionByProperty"] {
  const byListing = new Map<string, { listingId: string; listingAlias: string; bookingCount: number; commissionPaise: number; netPaise: number }>();
  for (const b of bookings) {
    const row = byListing.get(b.listingId) ?? {
      listingId: b.listingId,
      listingAlias: b.listingAlias,
      bookingCount: 0,
      commissionPaise: 0,
      netPaise: 0,
    };
    row.bookingCount += 1;
    row.commissionPaise += b.money.commissionPaise;
    row.netPaise += b.money.netPaise;
    byListing.set(b.listingId, row);
  }
  // Biggest commission earners first; alias as a stable tiebreaker.
  return [...byListing.values()].sort(
    (a, z) => z.commissionPaise - a.commissionPaise || (a.listingAlias < z.listingAlias ? -1 : 1),
  );
}

function bookingsByMonth(bookings: FinanceBooking[], period: FinancialPeriod): ErpDashboardResponse["bookingsByMonth"] {
  const acc = new Map<string, { bookingCount: number; commissionPaise: number; netPaise: number }>();
  for (const b of bookings) {
    if (!b.confirmedAt) continue; // a confirmed-paid booking always has confirmedAt, but be defensive
    const key = monthKeyOf(b.confirmedAt);
    const cell = acc.get(key) ?? { bookingCount: 0, commissionPaise: 0, netPaise: 0 };
    cell.bookingCount += 1;
    cell.commissionPaise += b.money.commissionPaise;
    cell.netPaise += b.money.netPaise;
    acc.set(key, cell);
  }
  // Zero-fill every month in the period so the axis is continuous.
  return enumerateMonths(period).map((m) => {
    const cell = acc.get(m.key) ?? { bookingCount: 0, commissionPaise: 0, netPaise: 0 };
    return { month: m.key, label: m.label, ...cell };
  });
}

function topAgents(bookings: FinanceBooking[], limit: number): ErpDashboardResponse["topAgents"] {
  const byAgent = new Map<string, { agentId: string; agentName: string | null; bookingCount: number; commissionPaise: number; netPaise: number }>();
  for (const b of bookings) {
    if (!b.agentId) continue; // self-serve bookings carry no agent
    const row = byAgent.get(b.agentId) ?? {
      agentId: b.agentId,
      agentName: b.agentName,
      bookingCount: 0,
      commissionPaise: 0,
      netPaise: 0,
    };
    row.bookingCount += 1;
    row.commissionPaise += b.money.commissionPaise;
    row.netPaise += b.money.netPaise;
    byAgent.set(b.agentId, row);
  }
  return [...byAgent.values()]
    .sort((a, z) => z.commissionPaise - a.commissionPaise || z.bookingCount - a.bookingCount)
    .slice(0, limit);
}

/** Per-month rows with a cumulative running balance across the period. */
function monthlyRows(bookings: FinanceBooking[], period: FinancialPeriod): ErpMoneyMonth[] {
  const acc = new Map<string, Omit<ErpMoneyMonth, "month" | "label" | "runningBalancePaise">>();
  for (const b of bookings) {
    if (!b.confirmedAt) continue;
    const key = monthKeyOf(b.confirmedAt);
    const cell =
      acc.get(key) ?? {
        bookingCount: 0,
        collectionPaise: 0,
        commissionPaise: 0,
        payoutPaise: 0,
        netPaise: 0,
        settledNetPaise: 0,
        pendingNetPaise: 0,
      };
    cell.bookingCount += 1;
    cell.collectionPaise += b.money.collectedPaise;
    cell.commissionPaise += b.money.commissionPaise;
    cell.payoutPaise += b.money.paidToPgPaise;
    cell.netPaise += b.money.netPaise;
    if (b.money.settlementStatus === "RECEIVED") cell.settledNetPaise += b.money.netPaise;
    else cell.pendingNetPaise += b.money.netPaise;
    acc.set(key, cell);
  }

  let running = 0;
  return enumerateMonths(period).map((m) => {
    const cell =
      acc.get(m.key) ?? {
        bookingCount: 0,
        collectionPaise: 0,
        commissionPaise: 0,
        payoutPaise: 0,
        netPaise: 0,
        settledNetPaise: 0,
        pendingNetPaise: 0,
      };
    running += cell.netPaise;
    return { month: m.key, label: m.label, ...cell, runningBalancePaise: running };
  });
}

function totalsOf(months: ErpMoneyMonth[]): ErpMoneyManagerResponse["totals"] {
  const t = {
    bookingCount: 0,
    collectionPaise: 0,
    commissionPaise: 0,
    payoutPaise: 0,
    netPaise: 0,
    settledNetPaise: 0,
    pendingNetPaise: 0,
  };
  for (const m of months) {
    t.bookingCount += m.bookingCount;
    t.collectionPaise += m.collectionPaise;
    t.commissionPaise += m.commissionPaise;
    t.payoutPaise += m.payoutPaise;
    t.netPaise += m.netPaise;
    t.settledNetPaise += m.settledNetPaise;
    t.pendingNetPaise += m.pendingNetPaise;
  }
  return t;
}

function customerDrilldown(bookings: FinanceBooking[]): ErpMoneyManagerResponse["customers"] {
  const byTenant = new Map<string, { tenantId: string; tenantName: string; bookingCount: number; collectionPaise: number; commissionPaise: number; netPaise: number }>();
  for (const b of bookings) {
    const row = byTenant.get(b.tenantId) ?? {
      tenantId: b.tenantId,
      tenantName: b.tenantName,
      bookingCount: 0,
      collectionPaise: 0,
      commissionPaise: 0,
      netPaise: 0,
    };
    row.bookingCount += 1;
    row.collectionPaise += b.money.collectedPaise;
    row.commissionPaise += b.money.commissionPaise;
    row.netPaise += b.money.netPaise;
    byTenant.set(b.tenantId, row);
  }
  // Who paid the most first; name as a stable tiebreaker.
  return [...byTenant.values()].sort(
    (a, z) => z.collectionPaise - a.collectionPaise || (a.tenantName < z.tenantName ? -1 : 1),
  );
}

function serializePeriod(period: FinancialPeriod): ErpFinancePeriod {
  return {
    financialYear: period.financialYear,
    label: period.label,
    fromInclusive: period.fromInclusive.toISOString(),
    toExclusive: period.toExclusive.toISOString(),
  };
}
