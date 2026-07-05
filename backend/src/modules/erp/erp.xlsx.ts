/**
 * True-OOXML workbook builder (§15.3 CA pack) — a thin, typed wrapper over exceljs
 * that turns declarative {@link Sheet} specs into a real multi-sheet `.xlsx`
 * (numbers stay numbers, money is right-formatted, an optional bold totals row).
 * This REPLACES the ERP-2 SpreadsheetML approach for the compliance pack: the
 * accountant's deliverable must be a genuine workbook, not a single XML table. One
 * {@link Sheet} definition drives BOTH the xlsx and the csv render so they cannot
 * drift. Money is stored as integer paise everywhere; a `rupees` cell renders it
 * as paise ÷ 100 (2 dp) — display-only division (see /CLAUDE.md money rule).
 */
import ExcelJS from "exceljs";

/** How a column's cells are typed/formatted. */
export type ColumnKind = "text" | "rupees" | "int" | "date";

export interface SheetColumn {
  header: string;
  kind: ColumnKind;
}

/** A cell value aligned to its column: text/date are strings, rupees are integer
 *  PAISE (converted to rupees on render), int is a whole number; null renders blank. */
export type CellValue = string | number | null;

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
  /** Optional bold totals row (already aligned to the columns; paise for rupees cols). */
  totalsRow?: CellValue[];
}

const RUPEE_FMT = "#,##0.00";
const INT_FMT = "#,##0";
/** Excel sheet names are ≤ 31 chars and may not contain : \ / ? * [ ]. */
const sanitizeName = (name: string): string => name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

/** paise → rupees number (2 dp), or null when the figure is absent. */
function toRupees(paise: CellValue): number | null {
  if (paise === null || typeof paise !== "number") return null;
  return Math.round(paise) / 100;
}

function applyCell(cell: ExcelJS.Cell, kind: ColumnKind, value: CellValue): void {
  if (value === null) return; // leave blank
  if (kind === "rupees") {
    const rupees = toRupees(value);
    if (rupees === null) return;
    cell.value = rupees;
    cell.numFmt = RUPEE_FMT;
  } else if (kind === "int") {
    cell.value = typeof value === "number" ? value : Number(value);
    cell.numFmt = INT_FMT;
  } else {
    // text / date
    cell.value = String(value);
  }
}

/** Build a real `.xlsx` workbook (one worksheet per sheet). Returns the bytes. */
export async function buildWorkbook(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RoomAdda ERP";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sanitizeName(sheet.name));
    const header = ws.addRow(sheet.columns.map((c) => c.header));
    header.font = { bold: true };

    for (const row of sheet.rows) {
      const added = ws.addRow(new Array(sheet.columns.length).fill(null));
      sheet.columns.forEach((col, i) => applyCell(added.getCell(i + 1), col.kind, row[i] ?? null));
    }

    if (sheet.totalsRow) {
      const totals = ws.addRow(new Array(sheet.columns.length).fill(null));
      sheet.columns.forEach((col, i) => applyCell(totals.getCell(i + 1), col.kind, sheet.totalsRow![i] ?? null));
      totals.font = { bold: true };
    }

    // Reasonable column widths from the header length.
    ws.columns.forEach((col, i) => {
      const headerLen = sheet.columns[i]?.header.length ?? 10;
      col.width = Math.min(40, Math.max(12, headerLen + 2));
    });
  }

  // exceljs types the return as a generic ArrayBuffer-ish; normalise to Buffer.
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// CSV render of the SAME sheet spec (single-report csv exports).
// ---------------------------------------------------------------------------
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvCell(kind: ColumnKind, value: CellValue): string {
  if (value === null) return "";
  if (kind === "rupees") {
    const rupees = toRupees(value);
    return rupees === null ? "" : String(rupees);
  }
  return String(value);
}

export function sheetToCsv(sheet: Sheet): string {
  const lines = [sheet.columns.map((c) => csvField(c.header)).join(",")];
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((c, i) => csvField(csvCell(c.kind, row[i] ?? null))).join(","));
  }
  if (sheet.totalsRow) {
    lines.push(sheet.columns.map((c, i) => csvField(csvCell(c.kind, sheet.totalsRow![i] ?? null))).join(","));
  }
  return lines.join("\r\n");
}
