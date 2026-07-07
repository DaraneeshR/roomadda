import type { Payment, PaymentTransaction, UserRole } from "@prisma/client";
import type { CancelBookingResponse, CancelledBy } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { razorpay } from "../../lib/razorpay.js";
import { logger } from "../../lib/logger.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { computeRefundPaise } from "./refund.policy.js";

/** Statuses a booking can be cancelled from. Others (EXPIRED/COMPLETED/already
 *  CANCELLED) cannot. */
const CANCELLABLE = new Set(["PENDING_APPROVAL", "TOKEN_PENDING", "CONFIRMED"]);

const bookingNotFound = () =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
const notCancellable = () =>
  new AppError({ statusCode: 409, code: "BOOKING_NOT_CANCELLABLE", message: "This booking can no longer be cancelled" });

/** The minimum a booking row must carry for cancellation (a superset of both loads). */
interface CancelableBooking {
  id: string;
  bedId: string;
  status: string;
  tokenAmountPaise: number;
  moveInDate: Date | null;
  payment: (Payment & { transactions: PaymentTransaction[] }) | null;
}

const withPayment = { payment: { include: { transactions: true } } } as const;

/**
 * Booking cancellation + refund — the SINGLE entry point for every cancellation
 * path (tenant self-cancel and host/admin decline) so the refund policy and the
 * "refund truth = webhook" rule are enforced in exactly one place (/CLAUDE.md).
 */
export const refundService = {
  /**
   * Tenant cancels their OWN booking. Ownership is enforced here: another tenant's
   * booking is reported as 404 (never 403) so the existence of the id is not
   * leaked. cancelledBy = TENANT, so the move-in-window policy applies.
   */
  async cancelByTenant(tenantId: string, bookingId: string, reason?: string): Promise<CancelBookingResponse> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: withPayment });
    if (!booking || booking.tenantId !== tenantId) throw bookingNotFound();
    if (!CANCELLABLE.has(booking.status)) throw notCancellable();
    return performCancellation({ booking, cancelledBy: "TENANT", actorId: tenantId, reason });
  },

  /**
   * Host (owner) or admin declines / marks the stay unavailable. Routes through
   * the SAME cancellation core with cancelledBy = HOST so the FULL-refund branch
   * applies (the tenant is never penalised for a host decline). Ownership mirrors
   * acceptBooking: a non-owner host sees 404.
   */
  async declineByHostOrAdmin(
    actor: { id: string; role: UserRole },
    bookingId: string,
    reason?: string,
  ): Promise<CancelBookingResponse> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ...withPayment, listing: { select: { hostId: true } } },
    });
    const isOwnerHost = actor.role === "HOST" && booking?.listing.hostId === actor.id;
    if (!booking || (actor.role !== "ADMIN" && !isOwnerHost)) throw bookingNotFound();
    if (!CANCELLABLE.has(booking.status)) throw notCancellable();
    return performCancellation({ booking, cancelledBy: "HOST", actorId: actor.id, reason });
  },

  /**
   * Cancel a B2C HOTEL reservation. Reuses the EXACT same machinery as a booking
   * cancellation — the tiered refund policy (computeRefundPaise, counting to
   * `checkIn`), the INITIATED RefundTransaction (its hotel-owner variant), the
   * gateway refund call, and — crucially — settlement ONLY via the verified
   * refund webhook (applyRefundWebhook). Nothing is forked. Cancelling a
   * reservation drops it out of the live set, which frees the room for the
   * overbooking guard automatically. Ownership is enforced (non-owner -> 404).
   */
  async cancelHotelReservationByGuest(
    guestId: string,
    reservationId: string,
    reason?: string,
  ): Promise<CancelBookingResponse> {
    const reservation = await prisma.hotelReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.guestId !== guestId) {
      throw new AppError({ statusCode: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
    }
    // HELD (unpaid hold) or CONFIRMED (paid) can be cancelled; EXPIRED/CANCELLED cannot.
    if (reservation.status !== "HELD" && reservation.status !== "CONFIRMED") {
      throw new AppError({ statusCode: 409, code: "RESERVATION_NOT_CANCELLABLE", message: "This reservation can no longer be cancelled" });
    }

    const now = new Date();
    const decision = computeRefundPaise({
      tokenPaise: reservation.tokenAmountPaise,
      moveInDate: reservation.checkIn,
      now,
      cancelledBy: "TENANT",
    });

    // Refundable online = the captured stay payment (present only once CONFIRMED).
    const capturedOnlinePaise =
      reservation.status === "CONFIRMED" && reservation.razorpayPaymentId ? reservation.tokenAmountPaise : 0;
    const refundPaise = Math.min(decision.refundPaise, capturedOnlinePaise);
    const willRefund = refundPaise > 0 && Boolean(reservation.razorpayPaymentId);

    const refundTxId = await prisma.$transaction(async (tx) => {
      await tx.hotelReservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      if (willRefund) {
        const created = await tx.refundTransaction.create({
          data: { hotelReservationId: reservation.id, amountPaise: refundPaise, status: "INITIATED" },
        });
        return created.id;
      }
      return null;
    });

    const refundStatus = willRefund ? "PENDING" : "NONE";
    await writeAudit({
      actorId: guestId,
      action: "hotel.reservation.cancelled",
      targetId: reservation.id,
      metadata: { cancelledBy: "TENANT", refundPaise, refundReason: decision.reason, refundStatus, reason: reason ?? null },
    });

    // Gateway call AFTER commit; only records the refund id — the RefundTransaction
    // stays INITIATED until the verified webhook settles it (refund truth = webhook).
    if (willRefund && refundTxId && reservation.razorpayPaymentId) {
      try {
        const { id: razorpayRefundId } = await razorpay.refund(reservation.razorpayPaymentId, refundPaise);
        await prisma.refundTransaction.update({ where: { id: refundTxId }, data: { razorpayRefundId } });
      } catch (err) {
        logger.error({ err, reservationId: reservation.id, refundTxId }, "hotel refund gateway call failed; left INITIATED to reconcile");
      }
    }

    return { status: "CANCELLED", refundPaise, refundReason: decision.reason, refundStatus };
  },
};

/**
 * Apply a cancellation: compute the refund, atomically cancel + free the bed +
 * record the (INITIATED) refund, then call the gateway. The synchronous gateway
 * response only stores the refund id — it NEVER settles the refund; that happens
 * solely via the verified `refund.processed`/`refund.failed` webhook.
 */
async function performCancellation(params: {
  booking: CancelableBooking;
  cancelledBy: CancelledBy;
  actorId: string;
  reason?: string;
}): Promise<CancelBookingResponse> {
  const { booking, cancelledBy, actorId, reason } = params;
  const now = new Date();

  const decision = computeRefundPaise({
    tokenPaise: booking.tokenAmountPaise,
    moveInDate: booking.moveInDate,
    now,
    cancelledBy,
  });

  // What can actually be refunded online: the captured Razorpay leg (the only
  // leg a gateway refund can return — a cash leg is reconciled out-of-band).
  const payment = booking.payment;
  const capturedTxn = payment?.transactions.find(
    (t) => t.method === "RAZORPAY" && t.status === "CAPTURED" && t.razorpayPaymentId,
  );
  const capturedOnlinePaise = capturedTxn?.amountPaise ?? 0;
  // Never refund more than was captured online (Razorpay rejects an over-refund).
  const refundPaise = Math.min(decision.refundPaise, capturedOnlinePaise);
  const willRefund = refundPaise > 0 && capturedTxn !== undefined && payment !== null;

  // Atomic: cancel + free the bed + record the INITIATED refund together.
  const refundTxId = await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy,
        refundPaise,
        refundReason: decision.reason,
      },
    });
    // Free the bed back to AVAILABLE (HELD while pending, BOOKED once CONFIRMED);
    // CANCELLED leaves the live set, releasing the partial unique index.
    await tx.bed.update({ where: { id: booking.bedId }, data: { status: "AVAILABLE" } });

    if (willRefund && payment) {
      const created = await tx.refundTransaction.create({
        data: { paymentId: payment.id, bookingId: booking.id, amountPaise: refundPaise, status: "INITIATED" },
      });
      return created.id;
    }
    return null;
  });

  const refundStatus = willRefund ? "PENDING" : "NONE";

  await writeAudit({
    actorId,
    action: "booking.cancelled",
    targetId: booking.id,
    metadata: { cancelledBy, refundPaise, refundReason: decision.reason, refundStatus, reason: reason ?? null },
  });

  // Gateway call AFTER commit (external I/O must not hold a DB tx open). On
  // success we only record the gateway refund id — the RefundTransaction stays
  // INITIATED until the verified webhook settles it. On failure the cancellation
  // still stands; the row is left INITIATED (no gateway id) for admin reconcile.
  if (willRefund && refundTxId && capturedTxn?.razorpayPaymentId) {
    try {
      const { id: razorpayRefundId } = await razorpay.refund(capturedTxn.razorpayPaymentId, refundPaise);
      await prisma.refundTransaction.update({ where: { id: refundTxId }, data: { razorpayRefundId } });
    } catch (err) {
      logger.error({ err, bookingId: booking.id, refundTxId }, "refund gateway call failed; left INITIATED to reconcile");
    }
  }

  return { status: "CANCELLED", refundPaise, refundReason: decision.reason, refundStatus };
}
