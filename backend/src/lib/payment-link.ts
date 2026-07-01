import { env, isProduction } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Assisted-booking payment link delivery (WhatsApp/SMS), behind an interface so
 * it is stubbable in tests/dev and swappable per environment — the same
 * Live/Stub pattern as razorpay.ts / sms.ts / storage.ts.
 *
 * CRITICAL (see /CLAUDE.md domain rule #2 + the agent spec): the link goes to the
 * USER's own device. The agent CANNOT pay on the user's behalf — the agent never
 * receives a payable order, only a confirmation that the link was sent. The
 * booking confirms ONLY via the signature-verified Razorpay webhook.
 */
export interface PaymentLinkParams {
  /** E.164 recipient (the tenant). */
  toPhone: string;
  tenantName: string;
  /** The masked listing alias (never the actualName — see /CLAUDE.md). */
  listingAlias: string;
  /** Formatted rupee amount, e.g. "₹5,000". */
  amountText: string;
  /** The URL the user opens to pay (carries the Razorpay order). */
  payUrl: string;
  /** When the link expires (the 2h hold window). */
  expiresAt: Date;
}

export interface PaymentLinkSender {
  /** Send an assisted-booking pay link to the USER. Best-effort. */
  sendAssistedBookingLink(params: PaymentLinkParams): Promise<void>;
}

/**
 * Build the user-facing pay URL for a booking. Points at PUBLIC_PAY_BASE_URL when
 * configured, else a stable local fallback (dev/test). The order id is carried so
 * the page can open Razorpay checkout for exactly that order.
 */
export function buildPayUrl(bookingId: string, razorpayOrderId: string): string {
  const base = env.PUBLIC_PAY_BASE_URL ?? "https://app.roomadda.local";
  return `${base.replace(/\/$/, "")}/pay/${bookingId}?order=${encodeURIComponent(razorpayOrderId)}`;
}

/** Dev/test stub: logs intent only (never the full link/PII), sends nothing. */
class StubPaymentLinkSender implements PaymentLinkSender {
  sendAssistedBookingLink(params: PaymentLinkParams): Promise<void> {
    logger.info(
      { toPhone: params.toPhone.replace(/\d(?=\d{2})/g, "x"), listing: params.listingAlias },
      "assisted-booking pay link (stub — BSP not registered)",
    );
    return Promise.resolve();
  }
}

// A live MSG91 WhatsApp/SMS sender would replace this once the BSP template is
// registered; the interface keeps that swap to this file only (secrets via env).
export const paymentLinkSender: PaymentLinkSender = isProduction
  ? new StubPaymentLinkSender()
  : new StubPaymentLinkSender();
