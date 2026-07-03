import { describe, expect, it } from "vitest";
import type { RentInvoice } from "@roomadda/shared";
import { isRentPaid, isRentPayable, rentAmountPaise } from "../lib/rent";

function invoice(overrides: Partial<RentInvoice>): RentInvoice {
  return {
    id: "inv-1",
    bookingId: "booking-1",
    periodMonth: "2026-08-01",
    periodLabel: "August 2026",
    amountPaise: 1_200_000, // ₹12,000 — server-owned
    dueDate: "2026-08-05T00:00:00.000Z",
    status: "DUE",
    daysOverdue: 0,
    paidAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("rentAmountPaise — the server amount, read not computed", () => {
  it("returns the invoice's server-owned amountPaise verbatim", () => {
    expect(rentAmountPaise(invoice({ amountPaise: 1_234_500 }))).toBe(1_234_500);
  });
});

describe("isRentPaid — PAID only via the verified webhook, never a callback", () => {
  it("is NOT paid while the server still reports DUE (e.g. right after the pay callback)", () => {
    expect(isRentPaid(invoice({ status: "DUE" }))).toBe(false);
    expect(isRentPaid(invoice({ status: "OVERDUE" }))).toBe(false);
  });

  it("is paid ONLY once the server reports PAID", () => {
    expect(isRentPaid(invoice({ status: "PAID", paidAt: "2026-08-03T00:00:00.000Z" }))).toBe(true);
  });
});

describe("isRentPayable — unpaid invoices are payable", () => {
  it("DUE and OVERDUE are payable; PAID is not", () => {
    expect(isRentPayable(invoice({ status: "DUE" }))).toBe(true);
    expect(isRentPayable(invoice({ status: "OVERDUE" }))).toBe(true);
    expect(isRentPayable(invoice({ status: "PAID" }))).toBe(false);
  });
});
