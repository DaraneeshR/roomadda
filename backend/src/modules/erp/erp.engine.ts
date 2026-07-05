/**
 * ERP money engine (§15.5) — the single shared calculation core every ERP screen
 * imports, so no two screens can disagree on a number. It is PURE: no DB, no env,
 * no clock reads except where a `now` is passed in explicitly. Every figure is
 * integer paise (see /CLAUDE.md money rule #1). The service layer feeds it
 * AUTHORITATIVE values (commission derived from the booking's rent, `collected`
 * aggregated from captured payments + cash); the engine never re-derives money
 * the webhook already owns — it only combines authoritative amounts.
 */
import type { BookingStatus, CancelledBy } from "@prisma/client";
import type {
  BookingApprovalStatus,
  CommissionSettlementStatus,
  InvoiceBreakdown,
  InvoiceLineItem,
  InvoiceType,
} from "@roomadda/shared";
import { assertPaise } from "../../lib/money.js";

/** Indian financial year starts on 1 April. FY 2026 = 1 Apr 2026 → 31 Mar 2027. */
export const FY_START_MONTH_INDEX = 3; // 0-based: April
const BPS_DIVISOR = 10_000;

/**
 * RoomAdda's commission on one booking = `bps` basis points of its monthly rent,
 * floored to whole paise. This is the ONE definition of the commission rate — the
 * ERP ledger and the agent scorecard both call it, so an agent's earned figure
 * and the ledger's commission figure can never diverge (§15.5).
 */
export function agentCommissionPaise(monthlyRentPaise: number, bps: number): number {
  assertPaise(monthlyRentPaise);
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DIVISOR) {
    throw new RangeError(`commission bps must be an integer in [0, ${BPS_DIVISOR}], got ${bps}`);
  }
  const commission = Math.floor((monthlyRentPaise * bps) / BPS_DIVISOR);
  assertPaise(commission);
  return commission;
}

/**
 * Net commission (§15.5): `net = commission + paidToPg − collected`, in integer
 * paise. Positive → the PG owner owes RoomAdda; negative → RoomAdda owes the
 * owner. Inputs are non-negative paise; the RESULT is a signed integer and is
 * intentionally NOT passed through {@link assertPaise} (which rejects negatives).
 */
export function netCommissionPaise(input: {
  commissionPaise: number;
  paidToPgPaise: number;
  collectedPaise: number;
}): number {
  assertPaise(input.commissionPaise);
  assertPaise(input.paidToPgPaise);
  assertPaise(input.collectedPaise);
  return input.commissionPaise + input.paidToPgPaise - input.collectedPaise;
}

/** Number of days in the UTC month that `date` falls in. */
export function daysInUtcMonth(date: Date): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Pro-rata first-month rent (§15.6): `monthlyRent ÷ daysInMonth × remainingDays`,
 * where `remainingDays` counts the move-in day through the last day of that month
 * inclusive. Move in on the 1st → the full month; move in on the last day → one
 * day. Kept SEPARATE from the recurring monthly rent so the first bill is fair and
 * the ongoing rent stays clean. Integer paise, rounded to the nearest paise.
 */
export function proRataFirstMonthRentPaise(monthlyRentPaise: number, moveIn: Date): number {
  assertPaise(monthlyRentPaise);
  if (!(moveIn instanceof Date) || Number.isNaN(moveIn.getTime())) {
    throw new RangeError("moveIn must be a valid Date");
  }
  const daysInMonth = daysInUtcMonth(moveIn);
  const dayOfMonth = moveIn.getUTCDate();
  const remainingDays = daysInMonth - dayOfMonth + 1;
  // Compute in paise-days then divide once, so a whole-month move-in returns the
  // rent exactly (remainingDays === daysInMonth ⇒ result === monthlyRentPaise).
  const proRata = Math.round((monthlyRentPaise * remainingDays) / daysInMonth);
  assertPaise(proRata);
  return proRata;
}

/**
 * Map a booking's REAL lifecycle to the §15.3 ledger "approval" column — the one
 * decision-state every ERP screen (ledger, approvals, detail) reads, so they can
 * never label the same booking differently. Pure; derived on read, never stored:
 *  - PENDING   → awaiting a decision (a Request-to-Book hold / fresh init)
 *  - APPROVED  → accepted (payment may still be pending, or already confirmed/complete)
 *  - REJECTED  → declined in review (cancelled by the HOST/SYSTEM, not the tenant)
 *  - CANCELLED → the tenant backed out, or the hold lapsed (EXPIRED)
 */
export function approvalStatusOf(status: BookingStatus, cancelledBy: CancelledBy | null): BookingApprovalStatus {
  switch (status) {
    case "INITIATED":
    case "PENDING_APPROVAL":
      return "PENDING";
    case "TOKEN_PENDING":
    case "CONFIRMED":
    case "COMPLETED":
      return "APPROVED";
    case "CANCELLED":
      // A HOST/SYSTEM cancellation is a rejection; a TENANT one (or unknown) is a cancellation.
      return cancelledBy === "HOST" || cancelledBy === "SYSTEM" ? "REJECTED" : "CANCELLED";
    case "EXPIRED":
      return "CANCELLED";
    default: {
      // Exhaustiveness guard: a new BookingStatus must be classified here.
      const _never: never = status;
      return _never;
    }
  }
}

/**
 * The full move-in invoice for one booking (§15.6), every figure from this
 * engine so the detail screen and any receipt agree to the paise. Pro-rata is
 * null when there is no move-in date (nothing to pro-rate against). The token is
 * a part-payment of the move-in total, so the balance owed is `moveInTotal −
 * token` (may be negative if the token over-covers — surfaced honestly, not clamped).
 */
export function computeInvoiceBreakdown(input: {
  monthlyRentPaise: number;
  depositPaise: number;
  tokenAmountPaise: number;
  moveIn: Date | null;
}): InvoiceBreakdown {
  assertPaise(input.monthlyRentPaise);
  assertPaise(input.depositPaise);
  assertPaise(input.tokenAmountPaise);
  const proRata = input.moveIn ? proRataFirstMonthRentPaise(input.monthlyRentPaise, input.moveIn) : null;
  const moveInTotalPaise = proRata === null ? null : proRata + input.depositPaise;
  const balanceDuePaise = moveInTotalPaise === null ? null : moveInTotalPaise - input.tokenAmountPaise;
  return {
    monthlyRentPaise: input.monthlyRentPaise,
    depositPaise: input.depositPaise,
    tokenAmountPaise: input.tokenAmountPaise,
    proRataFirstMonthRentPaise: proRata,
    moveInTotalPaise,
    balanceDuePaise,
  };
}

/**
 * The composed invoice both Invoice-Center screens render: the line items plus
 * the total / amount-paid / balance triple. Produced by the pure composers below
 * so the list row, the review screen, and the PDF are the identical code path.
 * `balancePaise` is signed (over-payment or a negative commission net surfaced
 * honestly, never clamped).
 */
export interface ComposedInvoice {
  type: InvoiceType;
  lineItems: InvoiceLineItem[];
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
}

/**
 * Compose the CUSTOMER invoice (§15.6) from the engine's move-in breakdown plus
 * the two NON-DERIVABLE manual figures (maintenance, electricity). The deposit
 * and the pro-rata first-month rent are ENGINE lines — taken straight from
 * {@link computeInvoiceBreakdown}, NEVER recomputed here — so they can never
 * drift from the booking detail. `total = deposit + proRata + maintenance +
 * electricity`; `paid` is what the tenant has paid (the engine-collected amount,
 * or an admin override); `balance = total − paid` (may be negative if over-paid).
 * Pure. A booking with no move-in has no pro-rata line (0).
 */
export function composeCustomerInvoice(input: {
  breakdown: InvoiceBreakdown;
  maintenancePaise: number;
  electricityPaise: number;
  paidPaise: number;
}): ComposedInvoice {
  assertPaise(input.maintenancePaise);
  assertPaise(input.electricityPaise);
  assertPaise(input.paidPaise);
  const depositPaise = input.breakdown.depositPaise;
  const proRataPaise = input.breakdown.proRataFirstMonthRentPaise ?? 0;
  const lineItems: InvoiceLineItem[] = [
    { code: "DEPOSIT", label: "Security deposit", amountPaise: depositPaise, source: "ENGINE" },
    { code: "PRO_RATA_RENT", label: "First month rent (pro-rata)", amountPaise: proRataPaise, source: "ENGINE" },
    { code: "MAINTENANCE", label: "Maintenance", amountPaise: input.maintenancePaise, source: "MANUAL" },
    { code: "ELECTRICITY", label: "Electricity", amountPaise: input.electricityPaise, source: "MANUAL" },
  ];
  const totalPaise = depositPaise + proRataPaise + input.maintenancePaise + input.electricityPaise;
  return { type: "CUSTOMER", lineItems, totalPaise, paidPaise: input.paidPaise, balancePaise: totalPaise - input.paidPaise };
}

/**
 * Compose the COMMISSION invoice (§15.6) for the PG owner from the engine's
 * per-booking money — commission, paidToPg, collected, net — plus the settlement
 * state. EVERY line is ENGINE (nothing is manual or editable). `total` is the NET
 * POSITION (`net = commission + paidToPg − collected`; may be negative — RoomAdda
 * owes the owner). `paid` is the net already settled (the whole net once RECEIVED,
 * else 0); `balance` is the outstanding net. Pure — `netPaise` is passed in from
 * {@link netCommissionPaise} so this composer never re-derives the net itself.
 */
export function composeCommissionInvoice(input: {
  commissionPaise: number;
  paidToPgPaise: number;
  collectedPaise: number;
  netPaise: number;
  settlementStatus: CommissionSettlementStatus;
}): ComposedInvoice {
  assertPaise(input.commissionPaise);
  assertPaise(input.paidToPgPaise);
  assertPaise(input.collectedPaise);
  const settled = input.settlementStatus === "RECEIVED";
  const paidPaise = settled ? input.netPaise : 0;
  const lineItems: InvoiceLineItem[] = [
    { code: "COMMISSION", label: "RoomAdda commission", amountPaise: input.commissionPaise, source: "ENGINE" },
    { code: "PAID_TO_PG", label: "Paid to PG owner", amountPaise: input.paidToPgPaise, source: "ENGINE" },
    { code: "COLLECTED", label: "Collected (online + cash)", amountPaise: input.collectedPaise, source: "ENGINE" },
    { code: "NET", label: "Net position", amountPaise: input.netPaise, source: "ENGINE" },
    {
      code: "SETTLEMENT",
      label: settled ? "Settlement (received)" : "Settlement (pending)",
      amountPaise: paidPaise,
      source: "ENGINE",
    },
  ];
  return { type: "COMMISSION", lineItems, totalPaise: input.netPaise, paidPaise, balancePaise: input.netPaise - paidPaise };
}

/**
 * The composed per-booking figures the ledger shows. Both the row serializer and
 * the totals roll-up call THIS, so a row's numbers and the headline totals are
 * produced by the identical code path (§15.5 "one answer, everywhere").
 */
export function computeLedgerFigures(input: {
  monthlyRentPaise: number;
  bps: number;
  paidToPgPaise: number;
  collectedPaise: number;
}): { commissionPaise: number; netPaise: number } {
  const commissionPaise = agentCommissionPaise(input.monthlyRentPaise, input.bps);
  const netPaise = netCommissionPaise({
    commissionPaise,
    paidToPgPaise: input.paidToPgPaise,
    collectedPaise: input.collectedPaise,
  });
  return { commissionPaise, netPaise };
}

export interface FinancialPeriod {
  financialYear: number;
  label: string;
  fromInclusive: Date;
  toExclusive: Date;
}

/** The Indian FY (start year) that a given instant falls in. */
export function financialYearOf(date: Date): number {
  const y = date.getUTCFullYear();
  return date.getUTCMonth() >= FY_START_MONTH_INDEX ? y : y - 1;
}

/**
 * Resolve the §15.3 global finance filter (FY / quarter / month) to a concrete
 * `[fromInclusive, toExclusive)` UTC range. `quarter` and `month` are mutually
 * exclusive and resolved WITHIN the FY (fiscal Q1 = Apr–Jun … Q4 = Jan–Mar;
 * `month` is a calendar month 1–12). When no FY is given it defaults to the FY of
 * `now`, so the range is always bounded. Pure — `now` is injected.
 */
export function resolveFinancialPeriod(
  filter: { financialYear?: number; quarter?: number; month?: number },
  now: Date,
): FinancialPeriod {
  if (filter.quarter !== undefined && filter.month !== undefined) {
    throw new RangeError("provide quarter or month, not both");
  }
  const fy = filter.financialYear ?? financialYearOf(now);

  if (filter.quarter !== undefined) {
    if (filter.quarter < 1 || filter.quarter > 4) throw new RangeError("quarter must be 1–4");
    // Quarter q starts (q-1)*3 months after the FY start (April).
    const startMonthOffset = (filter.quarter - 1) * 3;
    const from = addMonthsToFyStart(fy, startMonthOffset);
    const to = addMonthsToFyStart(fy, startMonthOffset + 3);
    return { financialYear: fy, label: `FY${fy}-${twoDigit(fy + 1)} Q${filter.quarter}`, fromInclusive: from, toExclusive: to };
  }

  if (filter.month !== undefined) {
    if (filter.month < 1 || filter.month > 12) throw new RangeError("month must be 1–12");
    // A calendar month belongs to FY `fy` if it's Apr–Dec of fy, or Jan–Mar of fy+1.
    const calendarYear = filter.month >= FY_START_MONTH_INDEX + 1 ? fy : fy + 1;
    const from = new Date(Date.UTC(calendarYear, filter.month - 1, 1));
    const to = new Date(Date.UTC(calendarYear, filter.month, 1));
    return {
      financialYear: fy,
      label: `${MONTH_NAMES[filter.month - 1]} ${calendarYear}`,
      fromInclusive: from,
      toExclusive: to,
    };
  }

  // Whole FY.
  return {
    financialYear: fy,
    label: `FY${fy}-${twoDigit(fy + 1)}`,
    fromInclusive: addMonthsToFyStart(fy, 0),
    toExclusive: addMonthsToFyStart(fy, 12),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function addMonthsToFyStart(fy: number, months: number): Date {
  return new Date(Date.UTC(fy, FY_START_MONTH_INDEX + months, 1));
}

function twoDigit(year: number): string {
  return String(year % 100).padStart(2, "0");
}
