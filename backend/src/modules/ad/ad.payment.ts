import type { Prisma } from "@prisma/client";

/**
 * Transition a paid ad slot to PENDING_APPROVAL. Called from the Razorpay
 * webhook (verified) inside its transaction. Kept free of Redis/other imports
 * so the webhook handler stays light. Idempotent: only acts on PENDING_PAYMENT.
 */
export async function markAdPaidByOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const ad = await tx.adSlot.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, status: true },
  });
  if (!ad || ad.status !== "PENDING_PAYMENT") return null;
  await tx.adSlot.update({
    where: { id: ad.id },
    data: { status: "PENDING_APPROVAL", paidAt: new Date() },
  });
  return ad.id;
}
