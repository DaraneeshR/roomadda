/**
 * ERP money engine (§15.5) — the single shared calculation core every ERP screen
 * imports, so no two screens can disagree on a number. It is PURE: no DB, no env,
 * no clock reads except where a `now` is passed in explicitly. Every figure is
 * integer paise (see /CLAUDE.md money rule #1). The service layer feeds it
 * AUTHORITATIVE values (commission derived from the booking's rent, `collected`
 * aggregated from captured payments + cash); the engine never re-derives money
 * the webhook already owns — it only combines authoritative amounts.
 */
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
