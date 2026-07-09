/**
 * Corporate (B2B) money engine — the ONE place corporate amounts are computed, so
 * every corporate surface (quotation builder, quotation view, corporate booking,
 * company invoice, the HR dashboard, the admin finance page) prices the same thing
 * identically. This is the corporate analog of the ERP money engine: PURE, integer
 * paise only (reuses `assertPaise` — never floats, never ad-hoc arithmetic in a
 * route/component, /CLAUDE.md money rule #1).
 *
 * It does NOT fork the ERP commission engine — that engine prices B2C PG-owner
 * commission (BPS of rent), a different thing. Corporate pricing is room-nights:
 *   line amount = unitPrice × quantity × nights
 *   subtotal    = Σ line amounts
 *   total       = subtotal + tax
 * A company invoice's total is the sum of the booking totals it aggregates.
 */
import { assertPaise } from "./money.js";

/** A single priced quotation line (integer paise). */
export interface CorporateLineInput {
  unitPricePaise: number;
  quantity: number;
  nights: number;
}

/** The amount for one line = unitPrice × quantity × nights. Integer paise. */
export function lineItemAmountPaise(line: CorporateLineInput): number {
  assertPaise(line.unitPricePaise);
  for (const n of [line.quantity, line.nights]) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`quantity and nights must be positive integers, got ${n}`);
    }
  }
  const amount = line.unitPricePaise * line.quantity * line.nights;
  assertPaise(amount);
  return amount;
}

/** Σ of the line amounts (the quotation subtotal), integer paise. */
export function sumLineItemsPaise(lines: CorporateLineInput[]): number {
  const subtotal = lines.reduce((acc, line) => acc + lineItemAmountPaise(line), 0);
  assertPaise(subtotal);
  return subtotal;
}

/** A quotation revision's total = subtotal + tax. Both integer paise. */
export function quotationTotalPaise(subtotalPaise: number, taxPaise: number): number {
  assertPaise(subtotalPaise);
  assertPaise(taxPaise);
  const total = subtotalPaise + taxPaise;
  assertPaise(total);
  return total;
}

/** A company invoice total = Σ of the booking totals it aggregates. Integer paise. */
export function invoiceTotalFromBookingsPaise(bookingTotalsPaise: number[]): number {
  const total = bookingTotalsPaise.reduce((acc, t) => {
    assertPaise(t);
    return acc + t;
  }, 0);
  assertPaise(total);
  return total;
}

/** Outstanding balance on an invoice = total − paid. Non-negative (never over-clamped
 *  below zero by callers; an over-pay is surfaced by the caller, not hidden here). */
export function invoiceBalancePaise(totalPaise: number, paidPaise: number): number {
  assertPaise(totalPaise);
  assertPaise(paidPaise);
  return totalPaise - paidPaise;
}

/** The due date for a CREDIT invoice = issue date + creditDays. PREPAY invoices are
 *  due immediately (issue date). Pure — `issuedAt` is injected. */
export function invoiceDueDate(mode: "PREPAY" | "CREDIT", issuedAt: Date, creditDays: number): Date {
  if (mode === "PREPAY") return new Date(issuedAt);
  if (!Number.isInteger(creditDays) || creditDays < 0) {
    throw new RangeError(`creditDays must be a non-negative integer, got ${creditDays}`);
  }
  return new Date(issuedAt.getTime() + creditDays * 24 * 60 * 60 * 1000);
}
