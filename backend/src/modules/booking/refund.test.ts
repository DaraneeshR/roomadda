import { describe, expect, it } from "vitest";
import { computeRefundPaise } from "./refund.js";

const TOKEN = 500_000;
const now = new Date("2026-06-01T00:00:00.000Z");

describe("computeRefundPaise (PRD §8.4)", () => {
  it("refunds nothing before confirmation (nothing captured yet)", () => {
    for (const status of ["PENDING_APPROVAL", "TOKEN_PENDING"]) {
      expect(computeRefundPaise({ status, tokenAmountPaise: TOKEN, moveInDate: new Date("2026-07-01"), now })).toBe(0);
    }
  });

  it("full refund when cancelled more than 7 days before move-in", () => {
    expect(computeRefundPaise({ status: "CONFIRMED", tokenAmountPaise: TOKEN, moveInDate: new Date("2026-06-30T00:00:00.000Z"), now })).toBe(TOKEN);
  });

  it("50% refund 3–7 days before move-in (inclusive of 7)", () => {
    expect(computeRefundPaise({ status: "CONFIRMED", tokenAmountPaise: TOKEN, moveInDate: new Date("2026-06-06T00:00:00.000Z"), now })).toBe(250_000); // 5 days
    expect(computeRefundPaise({ status: "CONFIRMED", tokenAmountPaise: TOKEN, moveInDate: new Date("2026-06-08T00:00:00.000Z"), now })).toBe(250_000); // exactly 7 days
  });

  it("no refund within 3 days of move-in", () => {
    expect(computeRefundPaise({ status: "CONFIRMED", tokenAmountPaise: TOKEN, moveInDate: new Date("2026-06-02T00:00:00.000Z"), now })).toBe(0); // 1 day
  });

  it("full refund when confirmed with no move-in date set", () => {
    expect(computeRefundPaise({ status: "CONFIRMED", tokenAmountPaise: TOKEN, moveInDate: null, now })).toBe(TOKEN);
  });
});
