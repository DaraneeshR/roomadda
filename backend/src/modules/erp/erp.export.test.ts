import { describe, expect, it } from "vitest";
import type { BookingLedgerEntry } from "@roomadda/shared";
import { toCsv, toExcelXml } from "./erp.export.js";

const base: BookingLedgerEntry = {
  bookingId: "b-1",
  approval: "APPROVED",
  bookingStatus: "CONFIRMED",
  tenantId: "t-1",
  tenantName: "Asha Rao",
  listingId: "l-1",
  listingAlias: "Green Nest",
  agentId: "a-1",
  agentName: "Agent Bala",
  agentChannel: "WALK_IN",
  monthlyRentPaise: 1_000_000,
  tokenAmountPaise: 500_000,
  depositPaise: 0,
  moveInDate: "2026-06-01T00:00:00.000Z",
  confirmedAt: "2026-06-01T00:00:00.000Z",
  createdAt: "2026-07-01T10:00:00.000Z",
  historical: true,
  commission: { commissionPaise: 100_000, paidToPgPaise: 0, collectedPaise: 500_000, netPaise: -400_000, status: "PENDING" },
};

describe("erp export — CSV", () => {
  it("renders a header + one row, money as rupees (paise ÷ 100)", () => {
    const csv = toCsv([base]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Booking ID");
    expect(header).toContain("Net Commission (INR)");
    // Money is display-rupees, not paise.
    expect(row).toContain("10000"); // monthly rent ₹10,000
    expect(row).toContain("-4000"); // net −₹4,000
    expect(row).toContain("Yes"); // historical flag
  });

  it("quotes fields containing a comma or quote (RFC 4180)", () => {
    const csv = toCsv([{ ...base, tenantName: 'Rao, "AJ"', agentName: null }]);
    expect(csv).toContain('"Rao, ""AJ"""');
    const row = csv.split("\r\n")[1]!;
    // A null agent name is an empty field, not the literal "null".
    expect(row).not.toContain("null");
  });

  it("leaves commission columns blank for a non-commissioned booking", () => {
    const csv = toCsv([{ ...base, approval: "PENDING", bookingStatus: "PENDING_APPROVAL", commission: null }]);
    const row = csv.split("\r\n")[1]!;
    // Trailing empty commission cells → the row ends with several commas.
    expect(row.endsWith(",,,,,")).toBe(true);
  });
});

describe("erp export — Excel (SpreadsheetML)", () => {
  it("is a valid Excel workbook with typed number cells", () => {
    const xml = toExcelXml([base]);
    expect(xml).toContain('progid="Excel.Sheet"');
    expect(xml).toContain('<Worksheet ss:Name="Bookings">');
    // Money is a Number cell (Excel keeps it numeric), in rupees.
    expect(xml).toContain('<Data ss:Type="Number">10000</Data>');
    expect(xml).toContain('<Data ss:Type="Number">-4000</Data>');
  });

  it("escapes XML-special characters in text", () => {
    const xml = toExcelXml([{ ...base, listingAlias: "A & B <Co>" }]);
    expect(xml).toContain("A &amp; B &lt;Co&gt;");
  });

  it("emits an empty cell for an absent commission figure", () => {
    const xml = toExcelXml([{ ...base, commission: null }]);
    expect(xml).toContain("<Cell/>");
  });
});
