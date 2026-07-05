import { describe, expect, it } from "vitest";
import {
  AGENT_INCENTIVE_TIERS,
  agentCommissionPaise,
  agentIncentiveTier,
  approvalStatusOf,
  composeCommissionInvoice,
  composeCustomerInvoice,
  computeInvoiceBreakdown,
  computeLedgerFigures,
  daysInUtcMonth,
  enumerateMonths,
  financialYearOf,
  monthKeyOf,
  netCommissionPaise,
  proRataFirstMonthRentPaise,
  resolveFinancialPeriod,
} from "./erp.engine.js";
import { InvalidMoneyError } from "../../lib/money.js";

const iso = (d: Date) => d.toISOString();

describe("erp money engine — net commission (§15.5)", () => {
  it("matches the PRD example exactly: 4000 + 2000 − 5000 = 1000", () => {
    expect(
      netCommissionPaise({ commissionPaise: 4000, paidToPgPaise: 2000, collectedPaise: 5000 }),
    ).toBe(1000);
  });

  it("positive net means the PG owner owes RoomAdda", () => {
    expect(netCommissionPaise({ commissionPaise: 10_000, paidToPgPaise: 0, collectedPaise: 3000 })).toBeGreaterThan(0);
  });

  it("negative net means RoomAdda owes the owner", () => {
    const net = netCommissionPaise({ commissionPaise: 1000, paidToPgPaise: 0, collectedPaise: 5000 });
    expect(net).toBe(-4000);
    expect(net).toBeLessThan(0);
  });

  it("is always an integer number of paise", () => {
    for (const [c, p, col] of [
      [4000, 2000, 5000],
      [1, 0, 0],
      [123_456, 789, 1_000_000],
    ] as const) {
      expect(Number.isInteger(netCommissionPaise({ commissionPaise: c, paidToPgPaise: p, collectedPaise: col }))).toBe(true);
    }
  });

  it("rejects non-integer or negative inputs (floats never represent money)", () => {
    expect(() => netCommissionPaise({ commissionPaise: 40.5, paidToPgPaise: 0, collectedPaise: 0 })).toThrow(InvalidMoneyError);
    expect(() => netCommissionPaise({ commissionPaise: 0, paidToPgPaise: -1, collectedPaise: 0 })).toThrow(InvalidMoneyError);
  });
});

describe("erp money engine — commission rate", () => {
  it("is bps of monthly rent, floored", () => {
    expect(agentCommissionPaise(1_000_000, 1000)).toBe(100_000); // 10% of ₹10,000
    expect(agentCommissionPaise(99, 1000)).toBe(9); // floor(9.9) — fraction dropped
    expect(agentCommissionPaise(500_000, 0)).toBe(0);
    expect(agentCommissionPaise(0, 1000)).toBe(0);
  });

  it("rejects an out-of-range bps", () => {
    expect(() => agentCommissionPaise(1_000_000, 10_001)).toThrow(RangeError);
    expect(() => agentCommissionPaise(1_000_000, -1)).toThrow(RangeError);
  });
});

describe("erp money engine — pro-rata first-month rent (§15.6)", () => {
  const RENT = 3_000_000; // ₹30,000

  it("move-in on the 1st bills the full month (30- and 31-day)", () => {
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 3, 1)))).toBe(RENT); // April, 30d
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 1)))).toBe(RENT); // July, 31d
  });

  it("mid-month move-in bills only the remaining days (inclusive)", () => {
    // 2026-07-04: 31 days, remaining 28 → round(3,000,000 × 28/31)
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 4)))).toBe(2_709_677);
  });

  it("move-in on the last day bills a single day", () => {
    // 2026-07-31: remaining 1 → round(3,000,000 / 31)
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 31)))).toBe(96_774);
  });

  it("handles a leap February (29 days)", () => {
    expect(daysInUtcMonth(new Date(Date.UTC(2024, 1, 1)))).toBe(29);
    // 2024-02-15: remaining 15 → round(3,000,000 × 15/29)
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2024, 1, 15)))).toBe(1_551_724);
  });

  it("handles a non-leap February (28 days)", () => {
    expect(daysInUtcMonth(new Date(Date.UTC(2023, 1, 1)))).toBe(28);
    // 2023-02-15: remaining 14 → exactly half the month
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2023, 1, 15)))).toBe(1_500_000);
  });

  it("always returns integer paise across every day of a month", () => {
    for (let day = 1; day <= 31; day++) {
      const v = proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, day)));
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(RENT);
    }
  });
});

describe("erp money engine — composed ledger figures", () => {
  it("computes commission and net from authoritative inputs on one path", () => {
    const figures = computeLedgerFigures({
      monthlyRentPaise: 1_000_000,
      bps: 1000,
      paidToPgPaise: 2000,
      collectedPaise: 5000,
    });
    expect(figures.commissionPaise).toBe(100_000);
    expect(figures.netPaise).toBe(100_000 + 2000 - 5000);
  });
});

describe("erp ledger — approval status mapping (§15.3)", () => {
  it("maps a Request-to-Book hold / fresh init to PENDING", () => {
    expect(approvalStatusOf("PENDING_APPROVAL", null)).toBe("PENDING");
    expect(approvalStatusOf("INITIATED", null)).toBe("PENDING");
  });

  it("maps accepted / confirmed / completed to APPROVED", () => {
    expect(approvalStatusOf("TOKEN_PENDING", null)).toBe("APPROVED");
    expect(approvalStatusOf("CONFIRMED", null)).toBe("APPROVED");
    expect(approvalStatusOf("COMPLETED", null)).toBe("APPROVED");
  });

  it("distinguishes a staff rejection from a tenant cancellation", () => {
    expect(approvalStatusOf("CANCELLED", "HOST")).toBe("REJECTED");
    expect(approvalStatusOf("CANCELLED", "SYSTEM")).toBe("REJECTED");
    expect(approvalStatusOf("CANCELLED", "TENANT")).toBe("CANCELLED");
    expect(approvalStatusOf("CANCELLED", null)).toBe("CANCELLED");
    expect(approvalStatusOf("EXPIRED", null)).toBe("CANCELLED");
  });
});

describe("erp money engine — invoice breakdown (§15.6)", () => {
  it("composes pro-rata + deposit − token, all from the engine", () => {
    // ₹30,000 rent, ₹20,000 deposit, ₹5,000 token, move-in 2026-07-04 (31d, 28 left).
    const inv = computeInvoiceBreakdown({
      monthlyRentPaise: 3_000_000,
      depositPaise: 2_000_000,
      tokenAmountPaise: 500_000,
      moveIn: new Date(Date.UTC(2026, 6, 4)),
    });
    expect(inv.proRataFirstMonthRentPaise).toBe(2_709_677); // round(3,000,000 × 28/31)
    expect(inv.moveInTotalPaise).toBe(2_709_677 + 2_000_000); // + deposit
    expect(inv.balanceDuePaise).toBe(2_709_677 + 2_000_000 - 500_000); // − token
  });

  it("nulls the pro-rata fields when there is no move-in date", () => {
    const inv = computeInvoiceBreakdown({
      monthlyRentPaise: 1_000_000,
      depositPaise: 500_000,
      tokenAmountPaise: 100_000,
      moveIn: null,
    });
    expect(inv.proRataFirstMonthRentPaise).toBeNull();
    expect(inv.moveInTotalPaise).toBeNull();
    expect(inv.balanceDuePaise).toBeNull();
    // The known figures still come through.
    expect(inv.monthlyRentPaise).toBe(1_000_000);
    expect(inv.depositPaise).toBe(500_000);
    expect(inv.tokenAmountPaise).toBe(100_000);
  });

  it("a full-month move-in bills the whole rent (balance = rent + deposit − token)", () => {
    const inv = computeInvoiceBreakdown({
      monthlyRentPaise: 3_000_000,
      depositPaise: 0,
      tokenAmountPaise: 3_000_000,
      moveIn: new Date(Date.UTC(2026, 6, 1)),
    });
    expect(inv.proRataFirstMonthRentPaise).toBe(3_000_000);
    expect(inv.balanceDuePaise).toBe(0); // token exactly covers the first month
  });
});

describe("erp money engine — financial period resolution (§15.3)", () => {
  const now = new Date(Date.UTC(2026, 6, 4)); // 2026-07-04 → FY2026

  it("derives the Indian FY (April boundary)", () => {
    expect(financialYearOf(new Date(Date.UTC(2026, 2, 31)))).toBe(2025); // 31 Mar 2026 → FY2025
    expect(financialYearOf(new Date(Date.UTC(2026, 3, 1)))).toBe(2026); // 1 Apr 2026 → FY2026
  });

  it("defaults to the current FY when nothing is given", () => {
    const p = resolveFinancialPeriod({}, now);
    expect(p.financialYear).toBe(2026);
    expect(iso(p.fromInclusive)).toBe("2026-04-01T00:00:00.000Z");
    expect(iso(p.toExclusive)).toBe("2027-04-01T00:00:00.000Z");
  });

  it("resolves a fiscal quarter within the FY", () => {
    const q1 = resolveFinancialPeriod({ financialYear: 2026, quarter: 1 }, now);
    expect(iso(q1.fromInclusive)).toBe("2026-04-01T00:00:00.000Z");
    expect(iso(q1.toExclusive)).toBe("2026-07-01T00:00:00.000Z");

    const q4 = resolveFinancialPeriod({ financialYear: 2026, quarter: 4 }, now);
    expect(iso(q4.fromInclusive)).toBe("2027-01-01T00:00:00.000Z");
    expect(iso(q4.toExclusive)).toBe("2027-04-01T00:00:00.000Z");
  });

  it("resolves a calendar month within the FY (Jan–Mar roll into fy+1)", () => {
    const jul = resolveFinancialPeriod({ financialYear: 2026, month: 7 }, now);
    expect(iso(jul.fromInclusive)).toBe("2026-07-01T00:00:00.000Z");
    expect(iso(jul.toExclusive)).toBe("2026-08-01T00:00:00.000Z");

    const feb = resolveFinancialPeriod({ financialYear: 2026, month: 2 }, now);
    expect(iso(feb.fromInclusive)).toBe("2027-02-01T00:00:00.000Z");
    expect(iso(feb.toExclusive)).toBe("2027-03-01T00:00:00.000Z");
  });

  it("rejects quarter and month together", () => {
    expect(() => resolveFinancialPeriod({ financialYear: 2026, quarter: 1, month: 4 }, now)).toThrow(RangeError);
  });
});

describe("erp money engine — invoice composers (§15.6)", () => {
  const breakdown = computeInvoiceBreakdown({
    monthlyRentPaise: 3_000_000,
    depositPaise: 2_000_000,
    tokenAmountPaise: 1_000_000,
    moveIn: new Date(Date.UTC(2026, 5, 15)), // 15 Jun 2026 → 16/30 pro-rata = 1,600,000
  });

  it("customer invoice: deposit + pro-rata (from the engine) + manual lines, total/paid/balance", () => {
    const inv = composeCustomerInvoice({ breakdown, maintenancePaise: 50_000, electricityPaise: 30_000, paidPaise: 1_500_000 });
    const line = (code: string) => inv.lineItems.find((l) => l.code === code)!;
    expect(line("DEPOSIT").amountPaise).toBe(2_000_000);
    expect(line("DEPOSIT").source).toBe("ENGINE");
    expect(line("PRO_RATA_RENT").amountPaise).toBe(1_600_000); // == the engine's pro-rata
    expect(line("MAINTENANCE").source).toBe("MANUAL");
    expect(inv.totalPaise).toBe(2_000_000 + 1_600_000 + 50_000 + 30_000);
    expect(inv.paidPaise).toBe(1_500_000);
    expect(inv.balancePaise).toBe(inv.totalPaise - 1_500_000);
  });

  it("customer invoice with no move-in has a zero pro-rata line", () => {
    const noMoveIn = computeInvoiceBreakdown({ monthlyRentPaise: 3_000_000, depositPaise: 2_000_000, tokenAmountPaise: 0, moveIn: null });
    const inv = composeCustomerInvoice({ breakdown: noMoveIn, maintenancePaise: 0, electricityPaise: 0, paidPaise: 0 });
    expect(inv.lineItems.find((l) => l.code === "PRO_RATA_RENT")!.amountPaise).toBe(0);
    expect(inv.totalPaise).toBe(2_000_000);
  });

  it("commission invoice: total is the net position; settled mirrors net into paid", () => {
    const net = netCommissionPaise({ commissionPaise: 300_000, paidToPgPaise: 0, collectedPaise: 1_500_000 });
    const pending = composeCommissionInvoice({ commissionPaise: 300_000, paidToPgPaise: 0, collectedPaise: 1_500_000, netPaise: net, settlementStatus: "PENDING" });
    expect(pending.lineItems.find((l) => l.code === "NET")!.amountPaise).toBe(net); // -1,200,000
    expect(pending.totalPaise).toBe(net);
    expect(pending.paidPaise).toBe(0);
    expect(pending.balancePaise).toBe(net);

    const settled = composeCommissionInvoice({ commissionPaise: 300_000, paidToPgPaise: 0, collectedPaise: 1_500_000, netPaise: net, settlementStatus: "RECEIVED" });
    expect(settled.paidPaise).toBe(net); // whole net settled
    expect(settled.balancePaise).toBe(0);
    expect(settled.lineItems.every((l) => l.source === "ENGINE")).toBe(true);
  });
});

describe("erp money engine — ERP-4 §15.3 finance helpers", () => {
  it("monthKeyOf buckets a UTC date to a zero-padded YYYY-MM key", () => {
    expect(monthKeyOf(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
    expect(monthKeyOf(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("enumerateMonths spans a whole FY as 12 ordered Apr→Mar months", () => {
    const period = resolveFinancialPeriod({ financialYear: 2026 }, new Date());
    const months = enumerateMonths(period);
    expect(months).toHaveLength(12);
    expect(months[0]!.key).toBe("2026-04");
    expect(months[0]!.label).toBe("Apr 2026");
    expect(months[11]!.key).toBe("2027-03");
    // Contiguous: each month's toExclusive is the next month's fromInclusive.
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i]!.fromInclusive.getTime()).toBe(months[i - 1]!.toExclusive.getTime());
    }
  });

  it("enumerateMonths spans a quarter as 3 months and a single month as 1", () => {
    expect(enumerateMonths(resolveFinancialPeriod({ financialYear: 2026, quarter: 1 }, new Date()))).toHaveLength(3);
    expect(enumerateMonths(resolveFinancialPeriod({ financialYear: 2026, month: 5 }, new Date()))).toHaveLength(1);
  });

  it("agentIncentiveTier classifies volume with the shared thresholds and next-tier gap", () => {
    expect(agentIncentiveTier(0).name).toBe("Bronze");
    expect(agentIncentiveTier(4).name).toBe("Bronze");
    const silver = agentIncentiveTier(5);
    expect(silver.name).toBe("Silver");
    expect(silver.nextTierName).toBe("Gold");
    expect(silver.bookingsToNextTier).toBe(5); // Gold at 10
    expect(agentIncentiveTier(10).name).toBe("Gold");

    // Top tier has no next.
    const top = agentIncentiveTier(50);
    expect(top.name).toBe("Platinum");
    expect(top.nextTierName).toBeNull();
    expect(top.bookingsToNextTier).toBeNull();

    // The tiers are ascending by threshold (the one source of truth).
    for (let i = 1; i < AGENT_INCENTIVE_TIERS.length; i += 1) {
      expect(AGENT_INCENTIVE_TIERS[i]!.minBookings).toBeGreaterThan(AGENT_INCENTIVE_TIERS[i - 1]!.minBookings);
    }
  });

  it("agentIncentiveTier rejects a negative or non-integer count", () => {
    expect(() => agentIncentiveTier(-1)).toThrow(RangeError);
    expect(() => agentIncentiveTier(1.5)).toThrow(RangeError);
  });
});
