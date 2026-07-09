import { describe, expect, it } from "vitest";
import type { Quotation } from "@roomadda/shared";
import {
  allocatedCount,
  corporateAccess,
  currentRevisionOf,
  enquiryStatusLabel,
  invoiceStatusLabel,
  isInvoicePayable,
  isQuotationActionable,
  orderedRevisions,
  quotationStatusLabel,
} from "../lib/corporate";

/** A quotation with two revisions (out of order) to exercise the history helpers. */
function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: "q1",
    companyId: "c1",
    enquiryId: "e1",
    status: "SENT",
    currentRevision: 2,
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    rejectedAt: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    revisions: [
      { id: "r2", revision: 2, subtotalPaise: 200, taxPaise: 0, totalPaise: 200, notes: null, createdAt: "2027-01-02T00:00:00.000Z", lineItems: [] },
      { id: "r1", revision: 1, subtotalPaise: 100, taxPaise: 0, totalPaise: 100, notes: null, createdAt: "2027-01-01T00:00:00.000Z", lineItems: [] },
    ],
    ...overrides,
  };
}

describe("corporate access gate", () => {
  it("maps session + overview state to an access decision", () => {
    expect(corporateAccess("loading", false, false)).toBe("loading");
    expect(corporateAccess("anonymous", false, false)).toBe("anonymous");
    expect(corporateAccess("authenticated", false, true)).toBe("forbidden");
    expect(corporateAccess("authenticated", true, false)).toBe("allowed");
    // Authenticated, not forbidden, but overview not loaded yet → still loading.
    expect(corporateAccess("authenticated", false, false)).toBe("loading");
  });
});

describe("quotation revision history (never overwritten)", () => {
  it("currentRevisionOf picks the highest revision number", () => {
    expect(currentRevisionOf(quotation())?.revision).toBe(2);
  });

  it("orderedRevisions returns oldest → newest for display", () => {
    expect(orderedRevisions(quotation()).map((r) => r.revision)).toEqual([1, 2]);
  });

  it("only a SENT quotation is actionable by the company", () => {
    expect(isQuotationActionable(quotation({ status: "SENT" }))).toBe(true);
    expect(isQuotationActionable(quotation({ status: "ACCEPTED" }))).toBe(false);
    expect(isQuotationActionable(quotation({ status: "DRAFT" }))).toBe(false);
  });
});

describe("labels + invoice payability", () => {
  it("labels each lifecycle state", () => {
    expect(quotationStatusLabel("NEGOTIATING")).toBe("Negotiating");
    expect(enquiryStatusLabel("CONVERTED")).toBe("Booked");
    expect(invoiceStatusLabel("OVERDUE")).toBe("Overdue");
  });

  it("only an unpaid invoice is payable", () => {
    expect(isInvoicePayable({ status: "DUE" })).toBe(true);
    expect(isInvoicePayable({ status: "OVERDUE" })).toBe(true);
    expect(isInvoicePayable({ status: "PAID" })).toBe(false);
  });

  it("allocatedCount counts only live allocations", () => {
    const booking = {
      id: "b1", companyId: "c1", quotationId: "q1", status: "CONFIRMED" as const, totalPaise: 100,
      confirmedAt: null, createdAt: "", reservations: [],
      allocations: [
        { id: "a1", employeeId: "e1", employeeName: "A", hotelReservationId: "res1", status: "ALLOCATED" as const, checkIn: null, checkOut: null, reservationStatus: null },
        { id: "a2", employeeId: "e2", employeeName: "B", hotelReservationId: "res2", status: "CANCELLED" as const, checkIn: null, checkOut: null, reservationStatus: null },
      ],
    };
    expect(allocatedCount(booking)).toBe(1);
  });
});
