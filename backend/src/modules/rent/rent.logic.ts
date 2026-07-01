import type { RentInvoiceStatus } from "@roomadda/shared";

/**
 * Pure rent scheduling + overdue logic, kept free of Prisma so it is unit-tested
 * directly. All date math is in UTC (the DB stores UTC); overdue is measured by
 * CALENDAR DAY so an invoice due today is not yet overdue and a one-day-late
 * invoice reads "1 day", never "0 days". Money stays integer paise.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Milliseconds at the start of the UTC day containing `d`. */
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Add `n` months to `date` in UTC, clamping the day to the target month's length
 * (e.g. Jan 31 + 1 month → Feb 28/29) so a due date never rolls into the next
 * month. Time-of-day is preserved.
 */
export function addMonthsUtc(date: Date, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastDayOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTarget);
  return new Date(
    Date.UTC(y, m + n, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
  );
}

/** First day (UTC midnight) of the month containing `d`. */
export function firstOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Stable "YYYY-MM" key for a billing month (used to dedupe generated periods). */
export function periodKey(periodMonth: Date): string {
  const y = periodMonth.getUTCFullYear();
  const m = (periodMonth.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

/** Human label for a billing month, e.g. "July 2026". */
export function periodLabel(periodMonth: Date): string {
  return `${MONTH_NAMES[periodMonth.getUTCMonth()]} ${periodMonth.getUTCFullYear()}`;
}

/** Whole days an unpaid invoice is past its due date; 0 when due today or future. */
export function rentOverdueDays(dueDate: Date, now: Date): number {
  const days = Math.floor((startOfUtcDay(now) - startOfUtcDay(dueDate)) / DAY_MS);
  return days > 0 ? days : 0;
}

/**
 * Effective invoice status the API reports: PAID always wins; otherwise OVERDUE
 * once the due date has passed (by calendar day), else DUE. Computed on read so
 * the API is correct even before the overdue sweep has run.
 */
export function effectiveRentStatus(
  stored: RentInvoiceStatus,
  dueDate: Date,
  now: Date,
): RentInvoiceStatus {
  if (stored === "PAID") return "PAID";
  return rentOverdueDays(dueDate, now) > 0 ? "OVERDUE" : "DUE";
}

/** A reminder we send ahead of a rent invoice's due date. */
export type RentReminderWindowKey = "DUE_IN_5_DAYS" | "DUE_IN_1_DAY";

export interface RentReminderWindow {
  key: RentReminderWindowKey;
  /** Lead time: how many whole days before the due date this window opens. */
  daysBefore: number;
}

/**
 * Reminder windows, ordered MOST URGENT first. Their day ranges are disjoint
 * (1-day covers due-day..1-day-out; 5-day covers 2..5 days out), so at most one
 * window is active for a given due date.
 */
export const RENT_REMINDER_WINDOWS: readonly RentReminderWindow[] = [
  { key: "DUE_IN_1_DAY", daysBefore: 1 },
  { key: "DUE_IN_5_DAYS", daysBefore: 5 },
];

/**
 * The reminder window (if any) to fire now for a DUE invoice, given the windows
 * already sent. Returns the active window's key when it is still unsent, else
 * null. Measured by CALENDAR DAY (like overdue), so a tick anywhere in the day
 * counts. Robust to a missed tick: a window still fires if the sweep skipped its
 * exact day and lands a day or two later inside the same range — but never the
 * 5-day window once we are already inside the 1-day window, and never once the
 * due date has passed (that is the OVERDUE path, not a reminder).
 */
export function dueRentReminderWindow(
  dueDate: Date,
  now: Date,
  sent: ReadonlySet<string>,
): RentReminderWindowKey | null {
  const days = Math.floor((startOfUtcDay(dueDate) - startOfUtcDay(now)) / DAY_MS);
  if (days < 0) return null; // already due/overdue — reminders are pre-due only
  let lower = -Infinity; // exclusive lower bound = the next-more-urgent window's lead time
  for (const w of RENT_REMINDER_WINDOWS) {
    if (days > lower && days <= w.daysBefore) {
      return sent.has(w.key) ? null : w.key;
    }
    lower = w.daysBefore;
  }
  return null;
}

export interface RentPeriodPlan {
  /** First day of the billing month (UTC). */
  periodMonth: Date;
  dueDate: Date;
  amountPaise: number;
}

/**
 * The rent periods to invoice for one active stay. The token covers the first
 * month (period 0), so rent begins at period 1 with a due date on the move-in
 * day each subsequent month. Returns every missing period whose due date is
 * already within `aheadMs` of `now` (so tenants can pay shortly before it falls
 * due), capped at `maxPeriods` to bound a long-outage backfill.
 */
export function rentPeriodsToGenerate(args: {
  moveInDate: Date;
  monthlyRentPaise: number;
  existingPeriodKeys: ReadonlySet<string>;
  now: Date;
  aheadMs: number;
  maxPeriods?: number;
}): RentPeriodPlan[] {
  const { moveInDate, monthlyRentPaise, existingPeriodKeys, now, aheadMs } = args;
  const maxPeriods = args.maxPeriods ?? 24;
  const horizon = now.getTime() + aheadMs;
  const plans: RentPeriodPlan[] = [];
  for (let k = 1; k <= maxPeriods; k++) {
    const dueDate = addMonthsUtc(moveInDate, k);
    if (dueDate.getTime() > horizon) break; // future period — not yet generatable
    const periodMonth = firstOfMonthUtc(dueDate);
    if (existingPeriodKeys.has(periodKey(periodMonth))) continue; // already invoiced
    plans.push({ periodMonth, dueDate, amountPaise: monthlyRentPaise });
  }
  return plans;
}
