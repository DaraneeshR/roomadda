import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Reuses the exact PG receipt approach (pdf-lib, single-page A4, same palette) —
// only the fields differ (nightly stay instead of a monthly token).
const inr = (paise: number): string => `INR ${(paise / 100).toFixed(2)}`;

export interface HotelReceiptData {
  reservationId: string;
  guestName: string;
  listingName: string;
  area: string;
  tier: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  perNightPaise: number;
  roomTotalPaise: number;
  paymentId: string | null;
  qrCodeToken: string | null;
  confirmedAt: Date | null;
}

const INK = rgb(0.11, 0.1, 0.09);
const ACCENT = rgb(0.84, 0.28, 0.23);
const MUTED = rgb(0.42, 0.4, 0.36);

const fmtDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "—");

/** Render a confirmed hotel reservation receipt as a single-page A4 PDF. */
export async function buildHotelReceiptPdf(d: HotelReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 48;
  page.drawText("RoomAdda", { x: left, y: 780, size: 24, font: bold, color: ACCENT });
  page.drawText("Hotel booking receipt", { x: left, y: 756, size: 12, font, color: MUTED });
  page.drawLine({ start: { x: left, y: 742 }, end: { x: 547, y: 742 }, thickness: 1, color: rgb(0.93, 0.91, 0.87) });

  let y = 712;
  const row = (label: string, value: string, valueBold = false): void => {
    page.drawText(label, { x: left, y, size: 11, font, color: MUTED });
    page.drawText(value, { x: 230, y, size: 12, font: valueBold ? bold : font, color: INK });
    y -= 28;
  };

  row("Reservation ID", d.reservationId);
  row("Status", "CONFIRMED", true);
  row("Confirmed on", fmtDate(d.confirmedAt));
  row("Guest", d.guestName);
  row("Property", d.listingName);
  row("Area", d.area);
  row("Room type", d.tier);
  row("Check-in", fmtDate(d.checkIn));
  row("Check-out", fmtDate(d.checkOut));
  row("Nights", String(d.nights));
  row("Per night", inr(d.perNightPaise));
  row("Total paid", inr(d.roomTotalPaise), true);
  row("Payment reference", d.paymentId ?? "—");
  row("Check-in code", d.qrCodeToken ?? "—");

  page.drawText("Present the check-in code at the front desk. This is a system-generated receipt.", {
    x: left,
    y: y - 12,
    size: 9,
    font,
    color: MUTED,
  });

  return doc.save();
}
