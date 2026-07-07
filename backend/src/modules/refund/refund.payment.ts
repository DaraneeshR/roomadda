import type { Prisma } from "@prisma/client";

/**
 * Settle a refund from a verified Razorpay refund webhook, inside its transaction.
 * REFUND TRUTH = THE VERIFIED WEBHOOK (see /CLAUDE.md domain rule #2): the
 * synchronous refund API only marks a RefundTransaction INITIATED; this is the
 * ONLY place it moves to a settled state (PROCESSED/FAILED). Matched by the
 * unique `razorpayRefundId`. Idempotent in TWO ways: a replay of the same event
 * id is dropped upstream by the WebhookEvent unique, and a RefundTransaction that
 * is already settled (status != INITIATED) is a no-op here. Kept import-light
 * (like markRentInvoicePaidByOrder / markAdPaidByOrder) so the webhook stays lean.
 * Returns the outcome when THIS call settled the refund, else null.
 */
export interface RefundWebhookOutcome {
  /** The booking id (booking refund) or hotel reservation id (hotel refund). */
  targetId: string;
  ownerKind: "booking" | "hotel";
  refundTransactionId: string;
  status: "PROCESSED" | "FAILED";
}

export async function applyRefundWebhook(
  tx: Prisma.TransactionClient,
  eventType: string,
  entity: { id?: string; payment_id?: string; amount?: number } | undefined,
  webhookEventId: string | null,
): Promise<RefundWebhookOutcome | null> {
  if (!entity?.id) return null;

  const refund = await tx.refundTransaction.findUnique({
    where: { razorpayRefundId: entity.id },
    select: {
      id: true,
      status: true,
      bookingId: true,
      paymentId: true,
      hotelReservationId: true,
      amountPaise: true,
    },
  });
  if (!refund) return null; // unknown refund id (not ours)
  if (refund.status !== "INITIATED") return null; // already settled — idempotent no-op

  // The refund is polymorphic (a booking token or a hotel reservation). Resolve
  // which owner it settles so the audit/notify targetId is correct either way.
  const target: { id: string; kind: "booking" | "hotel" } | null = refund.bookingId
    ? { id: refund.bookingId, kind: "booking" }
    : refund.hotelReservationId
      ? { id: refund.hotelReservationId, kind: "hotel" }
      : null;
  if (!target) return null; // orphan row (never expected — a refund always has an owner)

  if (eventType === "refund.processed") {
    await tx.refundTransaction.update({
      where: { id: refund.id },
      data: { status: "PROCESSED", processedAt: new Date(), webhookEventId },
    });
    // Booking refunds also flip the original Payment to REFUNDED when the settled
    // refund covers the full captured amount (a partial leaves the capture). Hotel
    // reservations carry no Payment row — the reservation is already CANCELLED, so
    // settling the RefundTransaction is all that is needed.
    if (refund.paymentId) {
      const payment = await tx.payment.findUnique({ where: { id: refund.paymentId }, select: { amountPaise: true } });
      if (payment && refund.amountPaise >= payment.amountPaise) {
        await tx.payment.update({ where: { id: refund.paymentId }, data: { status: "REFUNDED" } });
      }
    }
    return { targetId: target.id, ownerKind: target.kind, refundTransactionId: refund.id, status: "PROCESSED" };
  }

  if (eventType === "refund.failed") {
    // FAILED is the admin flag: the cancellation stands (the booking/reservation is
    // already CANCELLED and its inventory freed), but the money did not move —
    // reconcile/retry.
    await tx.refundTransaction.update({
      where: { id: refund.id },
      data: { status: "FAILED", webhookEventId },
    });
    return { targetId: target.id, ownerKind: target.kind, refundTransactionId: refund.id, status: "FAILED" };
  }

  return null;
}
