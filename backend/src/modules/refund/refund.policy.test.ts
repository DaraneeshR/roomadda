import { describe, expect, it } from "vitest";
import { computeRefundPaise, REFUND_REASONS } from "./refund.policy.js";

/**
 * Pure-policy unit tests (no DB, no clock). `now` is fixed; move-in dates are
 * derived as exact day offsets so the 3- and 7-day boundaries are unambiguous.
 */
const TOKEN = 500_000;
const NOW = new Date("2026-06-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

describe("computeRefundPaise — tenant, by move-in window", () => {
  it("FULL refund more than 7 days out (day 8)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(8), now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: TOKEN,
      reason: REFUND_REASONS.fullWindow,
    });
  });

  it("50% refund at the 7-day boundary (inclusive of 7)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(7), now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: 250_000,
      reason: REFUND_REASONS.partialWindow,
    });
  });

  it("50% refund in the middle of the window (day 5)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(5), now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: 250_000,
      reason: REFUND_REASONS.partialWindow,
    });
  });

  it("50% refund at the 3-day boundary (inclusive of 3)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(3), now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: 250_000,
      reason: REFUND_REASONS.partialWindow,
    });
  });

  it("NO refund inside 3 days (day 2)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(2), now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: 0,
      reason: REFUND_REASONS.noWindow,
    });
  });

  it("NO refund when move-in is exactly now (0 days)", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: NOW, now: NOW, cancelledBy: "TENANT" }).refundPaise).toBe(0);
  });

  it("FULL refund far in the future", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(365), now: NOW, cancelledBy: "TENANT" }).refundPaise).toBe(TOKEN);
  });

  it("FULL refund when no move-in date is set", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: null, now: NOW, cancelledBy: "TENANT" })).toEqual({
      refundPaise: TOKEN,
      reason: REFUND_REASONS.fullWindow,
    });
  });
});

describe("computeRefundPaise — host/system always FULL", () => {
  it("HOST decline is a full refund even inside the no-refund window", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: inDays(1), now: NOW, cancelledBy: "HOST" })).toEqual({
      refundPaise: TOKEN,
      reason: REFUND_REASONS.hostCancelled,
    });
  });

  it("SYSTEM (PG unavailable) is a full refund even with no move-in date", () => {
    expect(computeRefundPaise({ tokenPaise: TOKEN, moveInDate: null, now: NOW, cancelledBy: "SYSTEM" })).toEqual({
      refundPaise: TOKEN,
      reason: REFUND_REASONS.pgUnavailable,
    });
  });
});

describe("computeRefundPaise — rounding", () => {
  it("rounds a 50% refund DOWN to whole paise (odd token)", () => {
    // 500_001 / 2 = 250_000.5 -> floored to 250_000 (never refund more than the half).
    expect(
      computeRefundPaise({ tokenPaise: 500_001, moveInDate: inDays(5), now: NOW, cancelledBy: "TENANT" }).refundPaise,
    ).toBe(250_000);
  });

  it("a full refund of an odd token is exact (no rounding)", () => {
    expect(
      computeRefundPaise({ tokenPaise: 500_001, moveInDate: inDays(30), now: NOW, cancelledBy: "TENANT" }).refundPaise,
    ).toBe(500_001);
  });
});
