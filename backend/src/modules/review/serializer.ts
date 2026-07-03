import { Prisma, type BookingStatus } from "@prisma/client";
import type { Review } from "@roomadda/shared";

/**
 * Review serializer + the pure eligibility rule (see /CLAUDE.md — default-deny,
 * enforced server-side). A review is PUBLIC: it carries the reviewer's display
 * name (reviews are attributed) and no other tenant PII. The listing's cached
 * rating aggregate lives on the listing serializer, not here.
 */

/** Relations loaded for every review read, so the DTO type stays aligned. */
export const reviewInclude = {
  tenant: { select: { fullName: true } },
} satisfies Prisma.ReviewInclude;

export type ReviewWithRelations = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

/**
 * A tenant may review a listing ONLY from an eligible stay: a booking that is
 * CONFIRMED (active-confirmed, per PRD) or COMPLETED. INITIATED/PENDING/EXPIRED/
 * CANCELLED stays never qualify — real stays come first.
 */
export const REVIEWABLE_BOOKING_STATUSES: readonly BookingStatus[] = ["CONFIRMED", "COMPLETED"];

/** Is this booking status one a tenant can review from? */
export function isReviewableStatus(status: BookingStatus): boolean {
  return REVIEWABLE_BOOKING_STATUSES.includes(status);
}

/**
 * May this caller write a review FROM this booking? Pure so it is unit-tested:
 * the booking must be the caller's OWN, on the SAME listing the review targets,
 * and in an eligible status. (One-review-per-booking is a separate DB guard.)
 */
export function canReviewFromBooking(
  booking: { tenantId: string; listingId: string; status: BookingStatus },
  ctx: { tenantId: string; listingId: string },
): boolean {
  return (
    booking.tenantId === ctx.tenantId &&
    booking.listingId === ctx.listingId &&
    isReviewableStatus(booking.status)
  );
}

/** Serialize a review row into the public Review DTO. */
export function toReview(review: ReviewWithRelations): Review {
  return {
    id: review.id,
    listingId: review.listingId,
    rating: review.rating,
    text: review.text ?? null,
    authorName: review.tenant.fullName,
    hostResponse: review.hostResponse ?? null,
    respondedAt: review.hostRespondedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
  };
}
