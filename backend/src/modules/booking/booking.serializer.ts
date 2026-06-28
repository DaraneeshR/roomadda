import { Prisma } from "@prisma/client";
import type { BookingDetail, PaymentSummary } from "@roomadda/shared";
import { listingInclude, toPrivateListing, toPublicListing } from "../listing/serializer.js";

/**
 * Tenant booking-read serializer. Builds the BookingDetail DTO the mobile
 * payment screen polls (status, confirmedAt, holdExpiresAt, the per-leg payment
 * summary) and applies the listing masking rule (see /CLAUDE.md domain rule #4):
 * a CONFIRMED booking unmasks the listing for its tenant, anything else stays
 * masked. The masking itself is delegated to the listing serializer — never
 * reimplemented here.
 */

/** Relations needed to serialize a booking for its tenant. Keeps types aligned. */
export const bookingDetailInclude = {
  payment: { include: { transactions: true } },
  cashCollections: true,
  listing: { include: { ...listingInclude, host: { select: { id: true, fullName: true } } } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingDetailInclude }>;

function toPaymentSummary(
  payment: BookingWithRelations["payment"],
  cashCollections: BookingWithRelations["cashCollections"],
): PaymentSummary | null {
  if (!payment) return null;
  // The single online (Razorpay) leg, if any; its capture is what the client polls.
  const online = payment.transactions.find((t) => t.method === "RAZORPAY");
  // A booking has at most one cash leg in the current flow.
  const cash = cashCollections[0];
  return {
    method: payment.method,
    status: payment.status,
    online: online
      ? { status: online.status, capturedAt: online.capturedAt?.toISOString() ?? null }
      : null,
    cash: cash ? { status: cash.status } : null,
  };
}

export function toBookingDetail(booking: BookingWithRelations): BookingDetail {
  // Masking: the tenant sees the unmasked listing AND the host's name ONLY once
  // the booking is CONFIRMED; otherwise the public/masked shape and no host name.
  const confirmed = booking.status === "CONFIRMED";
  const listing = confirmed ? toPrivateListing(booking.listing) : toPublicListing(booking.listing);

  return {
    id: booking.id,
    bedId: booking.bedId,
    listingId: booking.listingId,
    status: booking.status,
    tokenAmountPaise: booking.tokenAmountPaise,
    monthlyRentPaise: booking.monthlyRentPaise,
    depositPaise: booking.depositPaise,
    moveInDate: booking.moveInDate?.toISOString() ?? null,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    mealPlan: booking.mealPlan ?? null,
    hostName: confirmed ? booking.listing.host.fullName : null,
    listing,
    payment: toPaymentSummary(booking.payment, booking.cashCollections),
  };
}
