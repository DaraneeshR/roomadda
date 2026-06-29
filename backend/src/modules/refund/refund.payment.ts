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
  bookingId: string;
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
    select: { id: true, status: true, bookingId: true, paymentId: true, amountPaise: true },
  });
  if (!refund) return null; // unknown refund id (not ours)
  if (refund.status !== "INITIATED") return null; // already settled — idempotent no-op

  if (eventType === "refund.processed") {
    await tx.refundTransaction.update({
      where: { id: refund.id },
      data: { status: "PROCESSED", processedAt: new Date(), webhookEventId },
    });
    // Flip the original Payment to REFUNDED ONLY when the settled refund covers
    // the full captured amount; a partial refund leaves the capture in place.
    const payment = await tx.payment.findUnique({ where: { id: refund.paymentId }, select: { amountPaise: true } });
    if (payment && refund.amountPaise >= payment.amountPaise) {
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: "REFUNDED" } });
    }
    return { bookingId: refund.bookingId, refundTransactionId: refund.id, status: "PROCESSED" };
  }

  if (eventType === "refund.failed") {
    // FAILED is the admin flag: the cancellation stands (the booking is already
    // CANCELLED and the bed freed), but the money did not move — reconcile/retry.
    await tx.refundTransaction.update({
      where: { id: refund.id },
      data: { status: "FAILED", webhookEventId },
    });
    return { bookingId: refund.bookingId, refundTransactionId: refund.id, status: "FAILED" };
  }

  return null;
}
