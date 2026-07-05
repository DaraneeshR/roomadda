/**
 * §15.3 finance-period helpers. The Indian financial year runs 1 Apr → 31 Mar and
 * is named by its START year (FY 2026 = 1 Apr 2026 → 31 Mar 2027), matching the
 * backend `financialYear` semantics. These only build filter-picker options; the
 * server is the source of truth for the resolved period it echoes back.
 */

/** The FY that a given date falls in (its April-start year). */
export function financialYearOf(date: Date): number {
  const y = date.getFullYear();
  // Jan–Mar (months 0–2) belong to the previous April's FY.
  return date.getMonth() < 3 ? y - 1 : y;
}

export function currentFinancialYear(): number {
  return financialYearOf(new Date());
}

/** The current FY plus the previous `count` years, newest first, for the FY picker. */
export function financialYearOptions(count = 5): number[] {
  const current = currentFinancialYear();
  return Array.from({ length: count }, (_, i) => current - i);
}

export const QUARTER_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Q1 (Apr–Jun)" },
  { value: 2, label: "Q2 (Jul–Sep)" },
  { value: 3, label: "Q3 (Oct–Dec)" },
  { value: 4, label: "Q4 (Jan–Mar)" },
];

export const MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
];
