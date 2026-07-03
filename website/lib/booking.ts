import type { BookingDetail, KycViewStatus, PrivateListing, PublicRoom } from "@roomadda/shared";

/**
 * Framework-free logic for the web booking + token-payment flow. Everything the
 * flow decides — the amount to pay, the KYC gate, when a booking is confirmed,
 * and when the listing/host are revealed — lives here as pure functions so it is
 * unit-tested without a DOM and can never drift into ad-hoc component code.
 *
 * The governing rules (see /CLAUDE.md): money is server-owned integer paise
 * (never computed client-side), payment truth is the verified webhook (never a
 * client callback), and masking is unwound only server-side on CONFIRMED.
 */

/**
 * The "pay now" token for a room — the SERVER-OWNED `tokenAmountPaise` straight
 * from the DTO. This function exists precisely so the token is READ, never
 * derived: it must NOT fall back to deposit or rent (that is the server's
 * `effectiveTokenPaise` policy, already applied before the DTO is built — see
 * /CLAUDE.md money rule #1 and the S1 fix).
 */
export function payNowPaise(room: Pick<PublicRoom, "tokenAmountPaise">): number {
  return room.tokenAmountPaise;
}

/** True only when a room has a server token AND at least one available bed. */
export function isRoomBookable(room: Pick<PublicRoom, "tokenAmountPaise" | "availableBeds">): boolean {
  return room.availableBeds > 0 && room.tokenAmountPaise > 0;
}

/**
 * Payment is allowed ONLY when KYC is VERIFIED. The backend enforces this on
 * both POST /bookings and POST /payment (requireKyc → 403 KYC_REQUIRED); the web
 * flow surfaces the gate up-front, it does not bypass it.
 */
export function canPayWithKyc(status: KycViewStatus | null | undefined): boolean {
  return status === "VERIFIED";
}

/**
 * Terminal outcome of the confirmation poll, or `null` while still pending. A
 * booking becomes `confirmed` ONLY when the SERVER reports status === CONFIRMED
 * (i.e. the signature-verified webhook has settled it). A Razorpay success
 * callback never reaches this function — the flow moves to a "confirming" poll,
 * and only a CONFIRMED snapshot resolves here.
 */
export type ConfirmOutcome =
  | { kind: "confirmed" }
  | { kind: "expired" }
  | { kind: "paymentFailed" };

export function classifyBooking(booking: Pick<BookingDetail, "status" | "payment">): ConfirmOutcome | null {
  if (booking.status === "CONFIRMED") return { kind: "confirmed" };
  if (booking.status === "EXPIRED" || booking.status === "CANCELLED") return { kind: "expired" };
  // The online leg was reported failed by the gateway (via the verified webhook).
  if (booking.payment?.online?.status === "FAILED") return { kind: "paymentFailed" };
  return null; // still pending → keep polling; the webhook has not settled yet
}

/** True once payment may be initiated (Instant Book, or an accepted request). */
export function isPayable(booking: Pick<BookingDetail, "status">): boolean {
  return booking.status === "TOKEN_PENDING";
}

/** A Request-to-Book hold still waiting for the host to accept (payment locked). */
export function isAwaitingApproval(booking: Pick<BookingDetail, "status">): boolean {
  return booking.status === "PENDING_APPROVAL";
}

/**
 * Whether the listing identity + host are revealed. This mirrors the backend
 * serializer (reveal only on CONFIRMED); we still read the server's shape rather
 * than trust it — a masked listing never carries the private fields.
 */
export function isRevealed(booking: Pick<BookingDetail, "status">): boolean {
  return booking.status === "CONFIRMED";
}

/** The unmasked listing for a confirmed booking, or null if still masked. */
export function revealedListing(booking: BookingDetail): PrivateListing | null {
  if (booking.listing.masked === false) return booking.listing;
  return null;
}

/** Shape of POST /v1/bookings/:id/payment (there is no shared schema for it). */
export interface TokenPaymentOrder {
  paymentId: string;
  amountPaise: number;
  razorpayOrder?: {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
  };
}

/**
 * Whether an order can go through REAL Razorpay web checkout. Locally the
 * gateway is stubbed (`order_stub_…`) and there is no reachable checkout, so the
 * flow falls back to the "confirming" poll that `demo:confirm` resolves. In
 * production a real `order_…` from a `rzp_…` key opens the hosted checkout.
 */
export function isRealCheckout(order: TokenPaymentOrder["razorpayOrder"] | undefined): boolean {
  if (!order) return false;
  if (!order.keyId.startsWith("rzp_")) return false;
  return !order.orderId.startsWith("order_stub");
}

/** ONLINE-only payment body for the web token: the full token online, no cash. */
export function onlinePaymentBody(tokenAmountPaise: number): {
  method: "ONLINE";
  onlinePaise: number;
  cashPaise: number;
} {
  return { method: "ONLINE", onlinePaise: tokenAmountPaise, cashPaise: 0 };
}
