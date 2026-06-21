import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { razorpay } from "../../lib/razorpay.js";
import { assertPaise } from "../../lib/money.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import type { CreatePaymentBody } from "./booking.schema.js";

export interface CreatePaymentResult {
  paymentId: string;
  amountPaise: number;
  razorpayOrder?: { orderId: string; amount: number; currency: string; keyId: string };
  cashCollectionId?: string;
}

export const paymentService = {
  /**
   * Initiate the token payment for a held booking. Creates the Payment, an
   * online PaymentTransaction (+ Razorpay order) for the online leg, and a
   * PENDING CashCollection assigned to the AGENT for the cash leg.
   *
   * This NEVER confirms the booking — confirmation only happens via the verified
   * webhook / cash reconciliation (settlement).
   */
  async createTokenPayment(
    bookingId: string,
    tenantId: string,
    input: CreatePaymentBody,
  ): Promise<CreatePaymentResult> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.tenantId !== tenantId) {
      throw new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }
    if (booking.status !== "TOKEN_PENDING") {
      throw new AppError({ statusCode: 409, code: "BOOKING_NOT_PAYABLE", message: "Booking is not awaiting payment" });
    }
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) {
      throw new AppError({ statusCode: 409, code: "HOLD_EXPIRED", message: "The hold on this bed has expired" });
    }

    assertPaise(input.onlinePaise);
    assertPaise(input.cashPaise);
    if (input.onlinePaise + input.cashPaise !== booking.tokenAmountPaise) {
      throw new AppError({
        statusCode: 400,
        code: "AMOUNT_MISMATCH",
        message: "onlinePaise + cashPaise must equal the booking token amount",
      });
    }

    // Validate the cash-handling agent.
    let agentId: string | undefined;
    if (input.cashPaise > 0) {
      if (!input.agentId) {
        throw new AppError({ statusCode: 400, code: "AGENT_REQUIRED", message: "agentId is required for a cash leg" });
      }
      const agent = await prisma.user.findUnique({ where: { id: input.agentId }, select: { role: true } });
      if (!agent || agent.role !== "AGENT") {
        throw new AppError({ statusCode: 400, code: "INVALID_AGENT", message: "agentId must reference an AGENT" });
      }
      agentId = input.agentId;
    }

    // One payment per booking.
    if (await prisma.payment.findUnique({ where: { bookingId }, select: { id: true } })) {
      throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
    }

    const methodEnum: Prisma.PaymentCreateInput["method"] =
      input.method === "ONLINE" ? "RAZORPAY" : input.method === "CASH" ? "CASH" : "SPLIT";

    // Create the Razorpay order BEFORE the transaction (external call must not
    // hold a DB transaction open).
    let order: { id: string; amount: number; currency: string } | undefined;
    if (input.onlinePaise > 0) {
      order = await razorpay.createOrder(input.onlinePaise, `booking_${bookingId}`);
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            bookingId,
            amountPaise: booking.tokenAmountPaise,
            method: methodEnum,
            status: "CREATED",
            razorpayOrderId: order?.id ?? null,
          },
        });
        if (input.onlinePaise > 0) {
          await tx.paymentTransaction.create({
            data: { paymentId: payment.id, amountPaise: input.onlinePaise, status: "CREATED", method: "RAZORPAY" },
          });
        }
        let cashCollectionId: string | undefined;
        if (input.cashPaise > 0 && agentId) {
          const cc = await tx.cashCollection.create({
            data: { bookingId, agentId, amountPaise: input.cashPaise, status: "PENDING" },
          });
          cashCollectionId = cc.id;
        }
        return { paymentId: payment.id, cashCollectionId };
      });

      return {
        paymentId: created.paymentId,
        amountPaise: booking.tokenAmountPaise,
        ...(order
          ? { razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID } }
          : {}),
        ...(created.cashCollectionId ? { cashCollectionId: created.cashCollectionId } : {}),
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
      }
      throw err;
    }
  },
};
