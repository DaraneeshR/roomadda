import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env, isProduction } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Razorpay integration, behind an interface so it is stubbable in tests and dev
 * (no real gateway calls). Order creation is the only outbound call; webhook
 * signature verification is the inbound trust boundary.
 */
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export interface RazorpayClient {
  createOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder>;
}

class LiveRazorpay implements RazorpayClient {
  async createOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, payment_capture: 1 }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "razorpay order creation failed");
      throw new AppError({
        statusCode: 502,
        code: "PAYMENT_GATEWAY_ERROR",
        message: "Could not create payment order",
      });
    }
    const data = (await res.json()) as { id: string; amount: number; currency: string };
    return { id: data.id, amount: data.amount, currency: data.currency };
  }
}

class StubRazorpay implements RazorpayClient {
  createOrder(amountPaise: number): Promise<RazorpayOrder> {
    return Promise.resolve({
      id: `order_stub_${randomUUID().replace(/-/g, "")}`,
      amount: amountPaise,
      currency: "INR",
    });
  }
}

export const razorpay: RazorpayClient = isProduction ? new LiveRazorpay() : new StubRazorpay();

/**
 * Verify X-Razorpay-Signature (HMAC-SHA256 of the RAW body) in constant time.
 * The raw request body — not a re-serialized object — must be passed in.
 */
export function verifyRazorpaySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
