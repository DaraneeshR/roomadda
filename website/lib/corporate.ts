import type {
  CorporateBooking,
  CorporateInvoice,
  CorporateInvoiceStatus,
  EnquiryStatus,
  Quotation,
  QuotationRevision,
  QuotationStatus,
} from "@roomadda/shared";

/**
 * Framework-free logic for the web Corporate Dashboard. Everything the portal
 * *decides* — the access gate, lifecycle labels, which revision is in force —
 * lives here as pure functions so it is unit-tested without a DOM and can never
 * drift into ad-hoc component code (mirrors lib/host.ts).
 *
 * MONEY IS DISPLAY-ONLY on the corporate web. Nothing here computes an amount —
 * every paise figure is read straight from the server DTO (the backend money
 * engine is the sole authority). EMPLOYEE PRIVACY: the employee stay view carries
 * no money field at all (enforced server-side), so there is nothing to hide here.
 */

/**
 * The corporate-portal access decision. Unlike the host portal there is no
 * platform role for a company user — membership IS the authorization, so the gate
 * is resolved by whether the backend returns the company overview (200) or denies
 * it (403 NOT_A_COMPANY_USER). This pure function maps those states:
 *   - "loading"   → session/overview still loading (skeleton),
 *   - "anonymous" → no session (prompt in-place login),
 *   - "forbidden" → authenticated but not a company member,
 *   - "allowed"   → a company member (render the dashboard).
 */
export type CorporateAccess = "loading" | "anonymous" | "forbidden" | "allowed";

export function corporateAccess(
  status: "loading" | "authenticated" | "anonymous",
  overviewLoaded: boolean,
  forbidden: boolean,
): CorporateAccess {
  if (status === "loading") return "loading";
  if (status === "anonymous") return "anonymous";
  if (forbidden) return "forbidden";
  return overviewLoaded ? "allowed" : "loading";
}

/** The in-force revision of a quotation (the highest revision number). Pure. */
export function currentRevisionOf(q: Quotation): QuotationRevision | null {
  if (q.revisions.length === 0) return null;
  return q.revisions.reduce((max, r) => (r.revision > max.revision ? r : max), q.revisions[0]!);
}

/** Revisions oldest → newest for rendering the full negotiation history. */
export function orderedRevisions(q: Quotation): QuotationRevision[] {
  return [...q.revisions].sort((a, b) => a.revision - b.revision);
}

/** May the company ACT on this quotation (accept / reject / request changes)? Only
 *  a SENT quotation is actionable. */
export function isQuotationActionable(q: Pick<Quotation, "status">): boolean {
  return q.status === "SENT";
}

/** May the company pay this invoice online now? Only an unpaid invoice. */
export function isInvoicePayable(i: Pick<CorporateInvoice, "status">): boolean {
  return i.status !== "PAID";
}

const QUOTATION_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  SENT: "Awaiting your response",
  NEGOTIATING: "Negotiating",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};
export function quotationStatusLabel(s: QuotationStatus): string {
  return QUOTATION_LABELS[s];
}

const ENQUIRY_LABELS: Record<EnquiryStatus, string> = {
  NEW: "New",
  QUOTED: "Quoted",
  CONVERTED: "Booked",
  CANCELLED: "Cancelled",
};
export function enquiryStatusLabel(s: EnquiryStatus): string {
  return ENQUIRY_LABELS[s];
}

const INVOICE_LABELS: Record<CorporateInvoiceStatus, string> = {
  DUE: "Due",
  PAID: "Paid",
  OVERDUE: "Overdue",
};
export function invoiceStatusLabel(s: CorporateInvoiceStatus): string {
  return INVOICE_LABELS[s];
}

/** Count a booking's allocated (non-cancelled) rooms — a display roll-up, not money. */
export function allocatedCount(b: CorporateBooking): number {
  return b.allocations.filter((a) => a.status === "ALLOCATED").length;
}
