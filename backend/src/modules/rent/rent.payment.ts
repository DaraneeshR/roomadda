import type { Prisma } from "@prisma/client";

/**
 * Mark a rent invoice PAID from a verified, captured Razorpay webhook, inside its
 * transaction. RENT IS MONEY (see /CLAUDE.md domain rule #2): this is the ONLY
 * place an invoice becomes PAID, and ONLY a FULL-amount capture pays it — a
 * partial capture leaves the invoice unpaid. Idempotent: an already-PAID invoice
 * is a no-op. Kept import-light (like markAdPaidByOrder) so the webhook handler
 * stays lean. Returns the invoice id when THIS call flipped it to PAID, else null.
 */
export async function markRentInvoicePaidByOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  entity: { id?: string; amount?: number } | undefined,
  webhookEventId: string | null,
): Promise<string | null> {
  const invoice = await tx.rentInvoice.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, status: true, amountPaise: true },
  });
  if (!invoice) return null; // not a rent order
  if (invoice.status === "PAID") return null; // already applied — idempotent no-op

  // Full payment only — never settle rent on a partial capture.
  const capturedPaise = entity?.amount ?? 0;
  if (capturedPaise < invoice.amountPaise) return null;

  await tx.rentInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      razorpayPaymentId: entity?.id ?? null,
      webhookEventId,
    },
  });
  return invoice.id;
}
