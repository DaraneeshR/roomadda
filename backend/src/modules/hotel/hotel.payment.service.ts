import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { razorpay } from "../../lib/razorpay.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import type { HotelPaymentResponse } from "@roomadda/shared";

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });

export const hotelPaymentService = {
  /**
   * Initiate the securing payment for a HELD reservation: create a server-side
   * Razorpay order for the server-owned `tokenAmountPaise` and stamp it on the
   * reservation. This NEVER confirms the reservation — confirmation happens ONLY
   * via the signature-verified webhook (see hotel.payment.ts + /CLAUDE.md money
   * rule #2). The amount is never taken from the client.
   */
  async createReservationOrder(reservationId: string, guestId: string): Promise<HotelPaymentResponse> {
    const r = await prisma.hotelReservation.findUnique({ where: { id: reservationId } });
    if (!r || r.guestId !== guestId) throw notFound();
    if (r.status !== "HELD") {
      throw new AppError({ statusCode: 409, code: "RESERVATION_NOT_PAYABLE", message: "Reservation is not awaiting payment" });
    }
    if (r.holdExpiresAt && r.holdExpiresAt.getTime() < Date.now()) {
      throw new AppError({ statusCode: 409, code: "HOLD_EXPIRED", message: "The hold on this room has expired" });
    }
    if (r.razorpayOrderId) {
      throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
    }
    assertPaise(r.tokenAmountPaise);

    // External call BEFORE the guarded write (never hold a DB tx open across I/O).
    const order = await razorpay.createOrder(r.tokenAmountPaise, `hotel_${r.id}`);

    try {
      // Conditional write: only stamp the order if still HELD + unstamped, so a
      // concurrent initiate can't create a second order for the same reservation.
      const updated = await prisma.hotelReservation.updateMany({
        where: { id: r.id, status: "HELD", razorpayOrderId: null },
        data: { razorpayOrderId: order.id },
      });
      if (updated.count === 0) {
        throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
      }
      throw err;
    }

    return {
      reservationId: r.id,
      amountPaise: r.tokenAmountPaise,
      razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  },
};
