import type { HotelCategoryAvailability, HotelReservation, HotelSearchResult } from "@roomadda/shared";
import { canPayWithKyc, isRealCheckout } from "./booking";

/**
 * Framework-free logic for the web B2C hotel flow, mirroring `lib/booking.ts`.
 * Everything the flow decides — the amount to pay, when a reservation is
 * confirmed, and the check-in code — lives here as pure functions so it is
 * unit-tested without a DOM and can never drift into ad-hoc component code.
 *
 * The governing rules (see /CLAUDE.md): money is the server-owned integer-paise
 * SNAPSHOT read from the DTO (NEVER perNightPaise × nights recomputed in JS),
 * payment truth is the verified webhook (never a client callback), and the
 * property stays masked until the guest holds a confirmed reservation.
 */

// KYC gate + real-vs-stub checkout are identical to the PG flow — reuse them so
// there is exactly one implementation of each rule across the site.
export { canPayWithKyc, isRealCheckout };

/**
 * The stay total for a searched category — the SERVER's `totalPaise`
 * (perNightPaise × nights, computed server-side), read straight from the DTO.
 * This function exists precisely so the total is READ, never derived: it must NOT
 * multiply `perNightPaise` by `nights` in JS (see /CLAUDE.md money rule #1).
 */
export function categoryTotalPaise(category: Pick<HotelCategoryAvailability, "totalPaise">): number {
  return category.totalPaise;
}

/** True only when a category has a nightly price AND at least one free B2C room. */
export function isCategoryBookable(
  category: Pick<HotelCategoryAvailability, "perNightPaise" | "availableRooms">,
): boolean {
  return category.availableRooms > 0 && category.perNightPaise > 0;
}

/**
 * The "pay now" amount for a held reservation — the SERVER-OWNED
 * `tokenAmountPaise` straight from the DTO (hotel is full-stay prepay, so this
 * equals `roomTotalPaise`). Read, never computed.
 */
export function reservationTokenPaise(reservation: Pick<HotelReservation, "tokenAmountPaise">): number {
  return reservation.tokenAmountPaise;
}

/** The server-snapshotted stay total on a reservation (integer paise). */
export function reservationTotalPaise(reservation: Pick<HotelReservation, "roomTotalPaise">): number {
  return reservation.roomTotalPaise;
}

/**
 * Terminal outcome of the confirmation poll, or `null` while still HELD. A
 * reservation becomes `confirmed` ONLY when the SERVER reports status ===
 * CONFIRMED (i.e. the signature-verified webhook has settled it and minted the
 * QR). A Razorpay success callback never reaches this function — the flow moves
 * to a "confirming" poll, and only a CONFIRMED snapshot resolves here.
 */
export type HotelConfirmOutcome = { kind: "confirmed" } | { kind: "expired" };

export function classifyReservation(
  reservation: Pick<HotelReservation, "status">,
): HotelConfirmOutcome | null {
  if (reservation.status === "CONFIRMED") return { kind: "confirmed" };
  if (reservation.status === "EXPIRED" || reservation.status === "CANCELLED") return { kind: "expired" };
  return null; // still HELD → keep polling; the webhook has not settled yet
}

/** True once the securing payment may be initiated (the reservation is HELD). */
export function isReservationPayable(reservation: Pick<HotelReservation, "status">): boolean {
  return reservation.status === "HELD";
}

/** True once the reservation is CONFIRMED (webhook-settled). */
export function isReservationConfirmed(reservation: Pick<HotelReservation, "status">): boolean {
  return reservation.status === "CONFIRMED";
}

/**
 * The check-in QR token, or null while still unconfirmed. Mirrors the backend:
 * the token is minted ONLY on the webhook-driven CONFIRMED, so a masked/held
 * reservation never carries one — the browser can never fabricate a check-in code.
 */
export function checkInCode(reservation: Pick<HotelReservation, "status" | "qrCodeToken">): string | null {
  return reservation.status === "CONFIRMED" ? reservation.qrCodeToken : null;
}

/** Shape of POST /api/hotels/reservations/:id/payment (mirrors HotelPaymentResponse). */
export interface HotelPaymentOrder {
  reservationId: string;
  amountPaise: number;
  razorpayOrder?: {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
  };
}

/** Total free B2C rooms across all bookable categories of a search result. */
export function totalAvailableRooms(result: Pick<HotelSearchResult, "categories">): number {
  return result.categories.reduce((sum, c) => sum + (c.availableRooms > 0 ? c.availableRooms : 0), 0);
}
