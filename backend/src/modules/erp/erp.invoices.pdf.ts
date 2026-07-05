import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Invoice } from "@roomadda/shared";

// ASCII money for the PDF — the standard (WinAnsi) fonts can't encode ₹.
// Display-only division by 100 (money stays integer paise; /CLAUDE.md). Signed
// so a commission invoice's negative net renders honestly.
const inr = (paise: number): string => `${paise < 0 ? "-" : ""}INR ${(Math.abs(paise) / 100).toFixed(2)}`;

const INK = rgb(0.11, 0.1, 0.09);
const ACCENT = rgb(0.84, 0.28, 0.23);
const MUTED = rgb(0.42, 0.4, 0.36);
const RULE = rgb(0.93, 0.91, 0.87);

const fmtDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "—");

export interface InvoicePdfData {
  invoice: Invoice;
  moveInDate: Date | null;
  generatedAt: Date;
}

/**
 * Render one ERP invoice (customer or commission) as a single-page A4 PDF,
 * mirroring the token/rent receipt style. Every figure is passed in already
 * composed by the money engine (see erp.engine.ts) — this renderer does no
 * arithmetic beyond the display /100. Returns the raw PDF bytes.
 */
export async function buildInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const { invoice } = d;
  const isCustomer = invoice.type === "CUSTOMER";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 48;
  const right = 547;
  page.drawText("RoomAdda", { x: left, y: 780, size: 24, font: bold, color: ACCENT });
  page.drawText(isCustomer ? "Customer invoice" : "Commission statement", {
    x: left,
    y: 756,
    size: 12,
    font,
    color: MUTED,
  });
  page.drawLine({ start: { x: left, y: 742 }, end: { x: right, y: 742 }, thickness: 1, color: RULE });

  // Meta block (recipient + booking context).
  let y = 716;
  const meta = (label: string, value: string): void => {
    page.drawText(label, { x: left, y, size: 11, font, color: MUTED });
    page.drawText(value, { x: 220, y, size: 12, font, color: INK });
    y -= 24;
  };
  meta("Booking ID", invoice.bookingId);
  meta(isCustomer ? "Billed to" : "PG owner", invoice.recipient.name);
  meta("Contact", invoice.recipient.phone);
  meta("Property", invoice.listingAlias);
  if (isCustomer) meta("Move-in date", fmtDate(d.moveInDate));
  meta("Status", invoice.status);

  // Line items table.
  y -= 8;
  page.drawText("Item", { x: left, y, size: 10, font: bold, color: MUTED });
  page.drawText("Amount", { x: right - 120, y, size: 10, font: bold, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: RULE });
  y -= 22;
  for (const line of invoice.lineItems) {
    page.drawText(line.label, { x: left, y, size: 11, font, color: INK });
    page.drawText(inr(line.amountPaise), { x: right - 120, y, size: 11, font, color: INK });
    y -= 22;
  }

  // Totals block.
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: RULE });
  y -= 22;
  const totalRow = (label: string, value: string, emphasise = false): void => {
    page.drawText(label, { x: left, y, size: 11, font: emphasise ? bold : font, color: emphasise ? INK : MUTED });
    page.drawText(value, { x: right - 120, y, size: 12, font: emphasise ? bold : font, color: INK });
    y -= 24;
  };
  if (isCustomer) {
    totalRow("Total", inr(invoice.totalPaise), true);
    totalRow("Amount paid", inr(invoice.paidPaise));
    totalRow("Balance due", inr(invoice.balancePaise), true);
  } else {
    totalRow("Net position", inr(invoice.totalPaise), true);
    totalRow("Settled", inr(invoice.paidPaise));
    totalRow("Outstanding", inr(invoice.balancePaise), true);
  }

  page.drawText(
    isCustomer
      ? "This is a system-generated invoice. The token already paid is reflected in the amount paid."
      : "This is a system-generated commission statement for the above booking.",
    { x: left, y: y - 8, size: 9, font, color: MUTED },
  );
  page.drawText(`Generated ${fmtDate(d.generatedAt)}`, { x: left, y: y - 24, size: 9, font, color: MUTED });

  return doc.save();
}
