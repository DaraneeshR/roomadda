/**
 * Bookings-ledger export (§15.3) — PURE, dependency-free serializers to CSV and
 * to Excel (SpreadsheetML 2003 XML, which Excel opens natively as a typed
 * workbook — numbers stay numbers). One column definition drives BOTH formats so
 * they can't drift. Money is stored as integer paise everywhere in the system;
 * for a human-facing spreadsheet it is rendered as rupees (paise ÷ 100, 2 dp) —
 * display-only division, the same the receipt PDF does (/CLAUDE.md money rule).
 */
import type { BookingLedgerEntry } from "@roomadda/shared";

/** A typed spreadsheet cell — text or number (number may be blank/null). */
type Cell = { t: "text"; v: string } | { t: "number"; v: number | null };

const text = (v: string | null | undefined): Cell => ({ t: "text", v: v ?? "" });
const num = (v: number | null): Cell => ({ t: "number", v });
/** paise → rupees number (2 dp), or null when the source figure is absent. */
const rupees = (paise: number | null | undefined): Cell =>
  num(paise === null || paise === undefined ? null : Math.round(paise) / 100);

interface Column {
  header: string;
  cell: (e: BookingLedgerEntry) => Cell;
}

/** The one column set both exporters render (order = the spreadsheet layout). */
const COLUMNS: Column[] = [
  { header: "Booking ID", cell: (e) => text(e.bookingId) },
  { header: "Approval", cell: (e) => text(e.approval) },
  { header: "Booking Status", cell: (e) => text(e.bookingStatus) },
  { header: "Historical", cell: (e) => text(e.historical ? "Yes" : "No") },
  { header: "Tenant", cell: (e) => text(e.tenantName) },
  { header: "Listing", cell: (e) => text(e.listingAlias) },
  { header: "Agent", cell: (e) => text(e.agentName) },
  { header: "Agent Channel", cell: (e) => text(e.agentChannel) },
  { header: "Monthly Rent (INR)", cell: (e) => rupees(e.monthlyRentPaise) },
  { header: "Token (INR)", cell: (e) => rupees(e.tokenAmountPaise) },
  { header: "Deposit (INR)", cell: (e) => rupees(e.depositPaise) },
  { header: "Move-in Date", cell: (e) => text(dateOnly(e.moveInDate)) },
  { header: "Confirmed At", cell: (e) => text(e.confirmedAt) },
  { header: "Created At", cell: (e) => text(e.createdAt) },
  { header: "Commission (INR)", cell: (e) => rupees(e.commission?.commissionPaise ?? null) },
  { header: "Collected (INR)", cell: (e) => rupees(e.commission?.collectedPaise ?? null) },
  { header: "Paid to PG (INR)", cell: (e) => rupees(e.commission?.paidToPgPaise ?? null) },
  { header: "Net Commission (INR)", cell: (e) => rupees(e.commission?.netPaise ?? null) },
  { header: "Settlement", cell: (e) => text(e.commission?.status ?? "") },
];

/** ISO timestamp → YYYY-MM-DD (dates read cleaner than full timestamps). */
function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

const cellString = (c: Cell): string => (c.t === "text" ? c.v : c.v === null ? "" : String(c.v));

// ---------------------------------------------------------------------------
// CSV (RFC 4180).
// ---------------------------------------------------------------------------
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entries: BookingLedgerEntry[]): string {
  const lines = [COLUMNS.map((c) => csvField(c.header)).join(",")];
  for (const e of entries) {
    lines.push(COLUMNS.map((c) => csvField(cellString(c.cell(e)))).join(","));
  }
  // CRLF line endings per RFC 4180 (Excel-friendly).
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Excel — SpreadsheetML 2003 (application/vnd.ms-excel). Opens natively in Excel.
// ---------------------------------------------------------------------------
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(c: Cell): string {
  if (c.t === "number") {
    if (c.v === null) return "<Cell/>";
    return `<Cell><Data ss:Type="Number">${c.v}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(c.v)}</Data></Cell>`;
}

export function toExcelXml(entries: BookingLedgerEntry[]): string {
  const header =
    "<Row>" + COLUMNS.map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`).join("") + "</Row>";
  const body = entries
    .map((e) => "<Row>" + COLUMNS.map((c) => xmlCell(c.cell(e))).join("") + "</Row>")
    .join("");
  return (
    '<?xml version="1.0"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Worksheet ss:Name="Bookings">\n<Table>\n' +
    header +
    body +
    "\n</Table>\n</Worksheet>\n</Workbook>"
  );
}
