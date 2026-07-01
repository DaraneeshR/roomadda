import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  dueRentReminderWindow,
  effectiveRentStatus,
  periodKey,
  periodLabel,
  rentOverdueDays,
  rentPeriodsToGenerate,
} from "./rent.logic.js";

const utc = (s: string) => new Date(s);

describe("addMonthsUtc", () => {
  it("adds whole months in UTC", () => {
    expect(addMonthsUtc(utc("2026-01-15T00:00:00Z"), 1).toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(addMonthsUtc(utc("2026-01-15T00:00:00Z"), 2).toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("clamps the day to the target month's length (no rollover)", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year), never Mar 3.
    expect(addMonthsUtc(utc("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("rentOverdueDays", () => {
  const now = utc("2026-07-20T10:00:00Z");
  it("is 0 when due today (by calendar day), even if hours have passed", () => {
    expect(rentOverdueDays(utc("2026-07-20T00:00:00Z"), now)).toBe(0);
  });
  it("is 0 when due in the future", () => {
    expect(rentOverdueDays(utc("2026-07-25T00:00:00Z"), now)).toBe(0);
  });
  it("counts whole days past the due date", () => {
    expect(rentOverdueDays(utc("2026-07-19T00:00:00Z"), now)).toBe(1);
    expect(rentOverdueDays(utc("2026-07-15T00:00:00Z"), now)).toBe(5);
  });
});

describe("effectiveRentStatus", () => {
  const now = utc("2026-07-20T10:00:00Z");
  it("PAID always wins, even past the due date", () => {
    expect(effectiveRentStatus("PAID", utc("2026-07-01T00:00:00Z"), now)).toBe("PAID");
  });
  it("an unpaid invoice past due reads OVERDUE", () => {
    expect(effectiveRentStatus("DUE", utc("2026-07-15T00:00:00Z"), now)).toBe("OVERDUE");
    expect(effectiveRentStatus("OVERDUE", utc("2026-07-15T00:00:00Z"), now)).toBe("OVERDUE");
  });
  it("an unpaid invoice due today or later reads DUE", () => {
    expect(effectiveRentStatus("DUE", utc("2026-07-20T00:00:00Z"), now)).toBe("DUE");
    expect(effectiveRentStatus("DUE", utc("2026-08-20T00:00:00Z"), now)).toBe("DUE");
  });
});

describe("dueRentReminderWindow", () => {
  const due = utc("2026-07-20T00:00:00Z");
  const none = new Set<string>();

  it("opens the 5-day window 5..2 days before the due date", () => {
    expect(dueRentReminderWindow(due, utc("2026-07-15T09:00:00Z"), none)).toBe("DUE_IN_5_DAYS"); // 5 days out
    expect(dueRentReminderWindow(due, utc("2026-07-18T23:00:00Z"), none)).toBe("DUE_IN_5_DAYS"); // 2 days out
  });

  it("does not remind before the 5-day window", () => {
    expect(dueRentReminderWindow(due, utc("2026-07-14T00:00:00Z"), none)).toBeNull(); // 6 days out
  });

  it("opens the 1-day window the day before and on the due day", () => {
    expect(dueRentReminderWindow(due, utc("2026-07-19T10:00:00Z"), none)).toBe("DUE_IN_1_DAY"); // 1 day out
    expect(dueRentReminderWindow(due, utc("2026-07-20T08:00:00Z"), none)).toBe("DUE_IN_1_DAY"); // due today
  });

  it("never re-sends a window already recorded", () => {
    expect(dueRentReminderWindow(due, utc("2026-07-15T00:00:00Z"), new Set(["DUE_IN_5_DAYS"]))).toBeNull();
    expect(dueRentReminderWindow(due, utc("2026-07-19T00:00:00Z"), new Set(["DUE_IN_1_DAY"]))).toBeNull();
  });

  it("does not back-fire the 5-day window once inside the 1-day window", () => {
    // Jumped straight to 1 day out without a 5-day tick: only the 1-day fires.
    expect(dueRentReminderWindow(due, utc("2026-07-19T00:00:00Z"), none)).toBe("DUE_IN_1_DAY");
  });

  it("stops reminding once the due date has passed (that is the OVERDUE path)", () => {
    expect(dueRentReminderWindow(due, utc("2026-07-21T00:00:00Z"), none)).toBeNull();
  });
});

describe("rentPeriodsToGenerate", () => {
  const moveInDate = utc("2026-01-15T00:00:00Z");
  const monthlyRentPaise = 1_200_000;
  const aheadMs = 7 * 24 * 60 * 60 * 1000;

  it("starts at period 1 (the token covers the first month) and stops at the horizon", () => {
    // now = Mar 20: periods due Feb 15 and Mar 15 are within now+7d; Apr 15 is not.
    const plans = rentPeriodsToGenerate({
      moveInDate,
      monthlyRentPaise,
      existingPeriodKeys: new Set(),
      now: utc("2026-03-20T00:00:00Z"),
      aheadMs,
    });
    expect(plans.map((p) => periodKey(p.periodMonth))).toEqual(["2026-02", "2026-03"]);
    expect(plans.every((p) => p.amountPaise === monthlyRentPaise)).toBe(true);
    // The move-in month itself (period 0) is never billed.
    expect(plans.map((p) => periodKey(p.periodMonth))).not.toContain("2026-01");
    expect(periodLabel(plans[0]!.periodMonth)).toBe("February 2026");
    expect(plans[0]!.dueDate.toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });

  it("skips periods already invoiced (idempotent generation)", () => {
    const plans = rentPeriodsToGenerate({
      moveInDate,
      monthlyRentPaise,
      existingPeriodKeys: new Set(["2026-02"]),
      now: utc("2026-03-20T00:00:00Z"),
      aheadMs,
    });
    expect(plans.map((p) => periodKey(p.periodMonth))).toEqual(["2026-03"]);
  });

  it("generates the upcoming period within the pay-ahead window before it falls due", () => {
    // now = Feb 10, due Feb 15 is 5 days away (< 7d ahead) → generated early.
    const plans = rentPeriodsToGenerate({
      moveInDate,
      monthlyRentPaise,
      existingPeriodKeys: new Set(),
      now: utc("2026-02-10T00:00:00Z"),
      aheadMs,
    });
    expect(plans.map((p) => periodKey(p.periodMonth))).toEqual(["2026-02"]);
  });

  it("generates nothing before the first rent period is near", () => {
    // now = Jan 20, first rent due Feb 15 is > 7 days away.
    const plans = rentPeriodsToGenerate({
      moveInDate,
      monthlyRentPaise,
      existingPeriodKeys: new Set(),
      now: utc("2026-01-20T00:00:00Z"),
      aheadMs,
    });
    expect(plans).toEqual([]);
  });
});
