/**
 * Pure leave-notice rules, free of Prisma so they are unit-tested directly. All
 * date math is by CALENDAR DAY in UTC (the DB stores UTC). A move-out must be at
 * least the notice period away, and a notice cannot be withdrawn within the lock
 * window before move-out.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default notice period (days). Common PG terms are one month. */
export const NOTICE_PERIOD_DAYS = 30;

/** A notice cannot be withdrawn within this many days of move-out. */
export const WITHDRAW_LOCK_DAYS = 3;

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Earliest move-out date a tenant may serve (today + notice period), UTC midnight. */
export function earliestMoveOutDate(now: Date, noticeDays = NOTICE_PERIOD_DAYS): Date {
  return new Date(startOfUtcDay(now) + noticeDays * DAY_MS);
}

/** Whole calendar days from today to the move-out date. */
export function daysUntilMoveOut(moveOutDate: Date, now: Date): number {
  return Math.floor((startOfUtcDay(moveOutDate) - startOfUtcDay(now)) / DAY_MS);
}

/** The move-out date (by calendar day) is on/after the earliest allowed date. */
export function isMoveOutDateValid(moveOutDate: Date, now: Date, noticeDays = NOTICE_PERIOD_DAYS): boolean {
  return daysUntilMoveOut(moveOutDate, now) >= noticeDays;
}

/** Withdrawal is allowed only while MORE than the lock window remains. */
export function canWithdrawNotice(moveOutDate: Date, now: Date, lockDays = WITHDRAW_LOCK_DAYS): boolean {
  return daysUntilMoveOut(moveOutDate, now) > lockDays;
}
