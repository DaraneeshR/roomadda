import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ASCII money for the PDF — the standard (WinAnsi) fonts can't encode ₹.
// Display-only division by 100 (money stays integer paise; /CLAUDE.md).
const inr = (paise: number): string => `INR ${(paise / 100).toFixed(2)}`;

export interface RentReceiptData {
  invoiceId: string;
  tenantName: string;
  listingName: string;
  area: string;
  periodLabel: string;
  amountPaise: number;
  paymentId: string | null;
  paidAt: Date | null;
}

const INK = rgb(0.11, 0.1, 0.09);
const ACCENT = rgb(0.84, 0.28, 0.23);
const MUTED = rgb(0.42, 0.4, 0.36);

const fmtDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "—");

/** Render a paid rent receipt as a single-page A4 PDF. Mirrors the token receipt. */
export async function buildRentReceiptPdf(d: RentReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 48;
  page.drawText("RoomAdda", { x: left, y: 780, size: 24, font: bold, color: ACCENT });
  page.drawText("Rent payment receipt", { x: left, y: 756, size: 12, font, color: MUTED });
  page.drawLine({ start: { x: left, y: 742 }, end: { x: 547, y: 742 }, thickness: 1, color: rgb(0.93, 0.91, 0.87) });

  let y = 712;
  const row = (label: string, value: string, valueBold = false): void => {
    page.drawText(label, { x: left, y, size: 11, font, color: MUTED });
    page.drawText(value, { x: 230, y, size: 12, font: valueBold ? bold : font, color: INK });
    y -= 28;
  };

  row("Invoice ID", d.invoiceId);
  row("Status", "PAID", true);
  row("Paid on", fmtDate(d.paidAt));
  row("Tenant", d.tenantName);
  row("Property", d.listingName);
  row("Area", d.area);
  row("Rent month", d.periodLabel);
  row("Amount paid", inr(d.amountPaise), true);
  row("Payment reference", d.paymentId ?? "—");

  page.drawText(
    "This is a system-generated receipt for your monthly rent payment.",
    { x: left, y: y - 12, size: 9, font, color: MUTED },
  );

  return doc.save();
}
