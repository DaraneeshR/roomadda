import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { verifyRazorpaySignature } from "../../lib/razorpay.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { settleBookingTx } from "./settlement.js";
import { notifyBookingConfirmed } from "../../lib/notifications.js";
import { markAdPaidByOrder } from "../ad/ad.payment.js";
import { markRentInvoicePaidByOrder } from "../rent/rent.payment.js";
import { markHotelReservationPaidByOrder } from "../hotel/hotel.payment.js";
import { applyRefundWebhook } from "../refund/refund.payment.js";

export interface WebhookResult {
  status: "processed" | "duplicate" | "ignored";
}

interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
  };
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
      } else if (eventType === "refund.processed" || eventType === "refund.failed") {
        // REFUND TRUTH = THIS WEBHOOK (see /CLAUDE.md): the only place a refund
        // settles. Reuses the same signature + idempotency plumbing above.
        processed = await handleRefundEvent(eventId, eventType, event.payload?.refund?.entity);
      }
      await prisma.webhookEvent.update({
        where: { provider_eventId: { provider: PROVIDER, eventId } },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      if (processed) {
        await writeAudit({
          action: auditActionFor(processed),
          targetId: processed.targetId,
          metadata: { ...processed.meta, eventId },
        });
        // Notify ONLY when this capture actually flipped the booking to CONFIRMED
        // (idempotent: a replay/no-op won't re-notify). Best-effort, post-commit.
        if (processed.kind === "booking" && processed.meta.confirmed === true) {
          await notifyBookingConfirmed(processed.targetId);
        }
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
  kind: "booking" | "rent" | "ad" | "hotel" | "refund";
  targetId: string;
  meta: Record<string, unknown>;
}

/** The audit action a processed event maps to. Refunds split by settled state. */
function auditActionFor(processed: CaptureResult): string {
  switch (processed.kind) {
    case "ad":
      return "ad.paid";
    case "rent":
      return "rent.paid";
    case "hotel":
      return "hotel.reservation.confirmed";
    case "refund":
      // "refund.failed" IS the admin flag — money did not move; reconcile.
      return processed.meta.refundStatus === "PROCESSED" ? "refund.processed" : "refund.failed";
    default:
      return "payment.captured";
  }
}

/**
 * Settle a refund from a verified refund webhook. Mirrors handlePaymentCaptured:
 * its own transaction, idempotent. Delegates the row work to applyRefundWebhook
 * (matched by the unique razorpay refund id). Returns null for an unknown refund
 * id or an already-settled refund (no-op) so the event is recorded as "ignored".
 */
async function handleRefundEvent(
  eventId: string,
  eventType: string,
  entity?: { id?: string; payment_id?: string; amount?: number },
): Promise<CaptureResult | null> {
  if (!entity?.id) return null;

  return prisma.$transaction(async (tx) => {
    const webhookEvent = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: PROVIDER, eventId } },
      select: { id: true },
    });
    const outcome = await applyRefundWebhook(tx, eventType, entity, webhookEvent?.id ?? null);
    if (!outcome) return null;
    return {
      kind: "refund",
      targetId: outcome.targetId,
      meta: {
        refundStatus: outcome.status,
        refundOwner: outcome.ownerKind,
        refundTransactionId: outcome.refundTransactionId,
        razorpayRefundId: entity.id,
      },
    };
  });
}

/**
 * Apply a captured payment. The same event type covers booking token payments,
 * recurring rent invoices, and ad-slot payments; dispatch by which entity owns
 * the order (order ids are unique per entity). One transaction, idempotent.
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
      const settled = await settleBookingTx(tx, payment.bookingId);
      return { kind: "booking", targetId: payment.bookingId, meta: { paymentId: payment.id, confirmed: settled.confirmed } };
    }

    // A recurring rent invoice? (RENT IS MONEY — only a full capture pays it.)
    const rentInvoiceId = await markRentInvoicePaidByOrder(tx, orderId, entity, webhookEvent?.id ?? null);
    if (rentInvoiceId) return { kind: "rent", targetId: rentInvoiceId, meta: {} };

    // A B2C hotel reservation? (only a full capture confirms the stay; mints the QR)
    const hotelReservationId = await markHotelReservationPaidByOrder(tx, orderId, entity, webhookEvent?.id ?? null);
    if (hotelReservationId) return { kind: "hotel", targetId: hotelReservationId, meta: {} };

    // Otherwise an ad-slot payment?
    const adSlotId = await markAdPaidByOrder(tx, orderId);
    if (adSlotId) return { kind: "ad", targetId: adSlotId, meta: {} };

    return null; // unknown order
  });
}
