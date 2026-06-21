import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { verifyRazorpaySignature } from "../../lib/razorpay.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { settleBookingTx } from "./settlement.js";
import { markAdPaidByOrder } from "../ad/ad.payment.js";

export interface WebhookResult {
  status: "processed" | "duplicate" | "ignored";
}

interface RazorpayEvent {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
}

const PROVIDER = "RAZORPAY" as const;

export const webhookService = {
  /**
   * Process a Razorpay webhook. Signature is verified over the raw body; the
   * WebhookEvent unique (provider, eventId) makes replays idempotent (first
   * writer wins). Only `payment.captured` triggers settlement.
   */
  async processRazorpay(
    rawBody: Buffer,
    signature: string | undefined,
    eventIdHeader: string | undefined,
  ): Promise<WebhookResult> {
    if (!verifyRazorpaySignature(rawBody, signature)) {
      throw new AppError({ statusCode: 400, code: "INVALID_SIGNATURE", message: "Invalid webhook signature" });
    }

    let event: RazorpayEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8")) as RazorpayEvent;
    } catch {
      throw new AppError({ statusCode: 400, code: "INVALID_PAYLOAD", message: "Invalid webhook payload" });
    }

    const eventType = event.event ?? "unknown";
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const eventId = eventIdHeader ?? payloadHash;

    // Idempotency: a duplicate delivery hits the unique constraint and is skipped.
    try {
      await prisma.webhookEvent.create({
        data: { provider: PROVIDER, eventId, eventType, status: "RECEIVED", payloadHash },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { status: "duplicate" };
      }
      throw err;
    }

    try {
      let processed: CaptureResult | null = null;
      if (eventType === "payment.captured") {
        processed = await handlePaymentCaptured(eventId, event.payload?.payment?.entity);
      }
      await prisma.webhookEvent.update({
        where: { provider_eventId: { provider: PROVIDER, eventId } },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      if (processed) {
        await writeAudit({
          action: processed.kind === "ad" ? "ad.paid" : "payment.captured",
          targetId: processed.targetId,
          metadata: { ...processed.meta, eventId },
        });
        return { status: "processed" };
      }
      return { status: "ignored" };
    } catch (err) {
      await prisma.webhookEvent
        .update({
          where: { provider_eventId: { provider: PROVIDER, eventId } },
          data: { status: "FAILED", error: err instanceof Error ? err.message : "unknown" },
        })
        .catch(() => undefined);
      throw err;
    }
  },
};

interface CaptureResult {
  kind: "booking" | "ad";
  targetId: string;
  meta: Record<string, unknown>;
}

/**
 * Apply a captured payment. The same event type covers booking token payments
 * and ad-slot payments; dispatch by which entity owns the order. One transaction,
 * idempotent.
 */
async function handlePaymentCaptured(
  eventId: string,
  entity?: { id?: string; order_id?: string; amount?: number },
): Promise<CaptureResult | null> {
  if (!entity?.order_id) return null;
  const orderId = entity.order_id;

  return prisma.$transaction(async (tx) => {
    const webhookEvent = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: PROVIDER, eventId } },
      select: { id: true },
    });

    // Booking token payment?
    const payment = await tx.payment.findUnique({
      where: { razorpayOrderId: orderId },
      include: { transactions: true },
    });
    if (payment) {
      // Find the still-uncaptured online txn; if none, already applied (no-op).
      const txn = payment.transactions.find((t) => t.method === "RAZORPAY" && t.status === "CREATED");
      if (!txn) return null;
      await tx.paymentTransaction.update({
        where: { id: txn.id },
        data: {
          status: "CAPTURED",
          capturedAt: new Date(),
          razorpayPaymentId: entity.id ?? null,
          webhookEventId: webhookEvent?.id ?? null,
        },
      });
      await settleBookingTx(tx, payment.bookingId);
      return { kind: "booking", targetId: payment.bookingId, meta: { paymentId: payment.id } };
    }

    // Otherwise an ad-slot payment?
    const adSlotId = await markAdPaidByOrder(tx, orderId);
    if (adSlotId) return { kind: "ad", targetId: adSlotId, meta: {} };

    return null; // unknown order
  });
}
