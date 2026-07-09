import type { Prisma } from "@prisma/client";
import { confirmBookingReservations } from "./corporate.booking.service.js";

/**
 * The ONE place a CorporateInvoice becomes PAID — shared by the ONLINE (webhook) and
 * OFFLINE (admin-marked) settlement paths so both settle identically. Marks the
 * invoice fully paid and, for a PREPAY booking still PENDING, confirms the booking +
 * its reservations (mirroring B2C webhook-confirm). A CREDIT booking is confirmed
 * separately by the CRM before the stay, so paying its post-stay invoice only closes
 * the receivable. Idempotent at the caller (only invoked once per settle).
 */
export async function applyInvoicePaidTx(
  tx: Prisma.TransactionClient,
  invoice: { id: string; billingMode: string; corporateBookingId: string | null; totalPaise: number },
  settle: { razorpayPaymentId?: string | null; webhookEventId?: string | null; settledById?: string | null; settlementRef?: string | null },
): Promise<void> {
  const now = new Date();
  await tx.corporateInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "PAID",
      paidPaise: invoice.totalPaise,
      paidAt: now,
      razorpayPaymentId: settle.razorpayPaymentId ?? undefined,
      webhookEventId: settle.webhookEventId ?? undefined,
      settledById: settle.settledById ?? undefined,
      settlementRef: settle.settlementRef ?? undefined,
    },
  });

  // PREPAY: paying the invoice is what confirms the stay (webhook-truth, or an
  // admin-marked offline prepay). Never confirm from a client success screen.
  if (invoice.billingMode === "PREPAY" && invoice.corporateBookingId) {
    const booking = await tx.corporateBooking.findUnique({
      where: { id: invoice.corporateBookingId },
      select: { status: true },
    });
    if (booking?.status === "PENDING") {
      await confirmBookingReservations(tx, invoice.corporateBookingId);
      await tx.corporateBooking.update({
        where: { id: invoice.corporateBookingId },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
    }
  }
}

/**
 * Settle a corporate invoice from a verified, captured Razorpay webhook, inside its
 * transaction. This is the ONLY place an ONLINE corporate invoice becomes PAID
 * (payment truth = verified webhook — /CLAUDE.md rule #2). Matched by the unique
 * `razorpayOrderId`; only a FULL-amount capture pays it. Idempotent: an already-PAID
 * invoice is a no-op. Import-light (like markHotelReservationPaidByOrder) so the
 * webhook handler stays lean. Returns the invoice id when THIS call paid it, else null.
 */
export async function markCorporateInvoicePaidByOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  entity: { id?: string; amount?: number } | undefined,
  webhookEventId: string | null,
): Promise<string | null> {
  const invoice = await tx.corporateInvoice.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, status: true, totalPaise: true, paidPaise: true, billingMode: true, corporateBookingId: true },
  });
  if (!invoice) return null; // not a corporate-invoice order
  if (invoice.status === "PAID") return null; // already applied — idempotent no-op

  // Full payment only — never mark paid on a partial capture.
  const capturedPaise = entity?.amount ?? 0;
  const balancePaise = invoice.totalPaise - invoice.paidPaise;
  if (capturedPaise < balancePaise) return null;

  await applyInvoicePaidTx(tx, invoice, { razorpayPaymentId: entity?.id ?? null, webhookEventId });
  return invoice.id;
}
