import type { RentInvoice, RentPayResponse } from "@roomadda/shared";

/**
 * Framework-free logic for the web "Pay Rent" flow. Mirrors lib/booking.ts: the
 * amount is the SERVER-OWNED integer paise read from the invoice DTO (never
 * computed), and an invoice becomes PAID ONLY when the server (via the verified
 * webhook) reports it — a Razorpay callback never marks it PAID (RENT IS MONEY;
 * see /CLAUDE.md domain rule #2).
 */

/** The amount to pay for an invoice — read from the DTO, never derived. */
export function rentAmountPaise(invoice: Pick<RentInvoice, "amountPaise">): number {
  return invoice.amountPaise;
}

/** Payable while unpaid (DUE or OVERDUE). A PAID invoice is not payable. */
export function isRentPayable(invoice: Pick<RentInvoice, "status">): boolean {
  return invoice.status === "DUE" || invoice.status === "OVERDUE";
}

/** True ONLY once the server reports the invoice PAID (verified webhook). */
export function isRentPaid(invoice: Pick<RentInvoice, "status">): boolean {
  return invoice.status === "PAID";
}

/** The POST /v1/rent/:id/pay response — a full-amount Razorpay order. */
export type RentPayOrder = RentPayResponse;
