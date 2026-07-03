import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { ratingAverage } from "../listing/serializer.js";
import type { ReviewSummary } from "@roomadda/shared";
import { isReviewableStatus, reviewInclude, type ReviewWithRelations } from "./serializer.js";
import type { CreateReviewInput, ListReviewsQuery } from "./review.schema.js";

/**
 * Reviews & ratings. Every write is gated server-side (see /CLAUDE.md
 * default-deny): a tenant reviews a listing ONLY from an eligible stay they own,
 * one review per booking, and a host replies ONLY on a listing they own. The
 * listing's cached rating aggregate is bumped ATOMICALLY in the same
 * transaction that inserts the review.
 */
export const reviewService = {
  /**
   * Create a review from the caller's eligible stay. The listing aggregate
   * (ratingSum/ratingCount) is incremented in the SAME transaction, so a
   * concurrent read never sees a review without its rating counted. The unique
   * (bookingId) constraint makes a double-submit fail the whole transaction (no
   * phantom increment) — surfaced as a clean 409.
   */
  async create(
    tenantId: string,
    listingId: string,
    input: CreateReviewInput,
  ): Promise<ReviewWithRelations> {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, tenantId: true, listingId: true, status: true },
    });
    // Privacy: a missing booking, another tenant's booking, or a booking on a
    // different listing are ALL "not found here" — never leak which one it was.
    if (!booking || booking.tenantId !== tenantId || booking.listingId !== listingId) {
      throw new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }
    if (!isReviewableStatus(booking.status)) {
      throw new AppError({
        statusCode: 403,
        code: "REVIEW_NOT_ELIGIBLE",
        message: "You can review a stay only once it is confirmed",
      });
    }

    try {
      const [review] = await prisma.$transaction([
        prisma.review.create({
          data: {
            bookingId: booking.id,
            listingId,
            tenantId,
            rating: input.rating,
            text: input.text ?? null,
          },
          include: reviewInclude,
        }),
        prisma.pgListing.update({
          where: { id: listingId },
          data: { ratingSum: { increment: input.rating }, ratingCount: { increment: 1 } },
        }),
      ]);
      return review;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({
          statusCode: 409,
          code: "REVIEW_EXISTS",
          message: "This stay has already been reviewed",
        });
      }
      throw err;
    }
  },

  /**
   * A listing's reviews, newest first, cursor-paginated, plus the cached
   * aggregate for the reviews-screen header. Public. A listing with zero reviews
   * returns `items: []` and `summary.ratingCount: 0` cleanly (empty state is
   * first-class). A missing listing is a 404.
   */
  async listForListing(
    listingId: string,
    query: ListReviewsQuery,
  ): Promise<{ page: Page<ReviewWithRelations>; summary: ReviewSummary }> {
    const listing = await prisma.pgListing.findUnique({
      where: { id: listingId },
      select: { ratingSum: true, ratingCount: true },
    });
    if (!listing) {
      throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
    }

    const rows = await prisma.review.findMany({
      where: { listingId },
      include: reviewInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return {
      page: toPage(rows, query.limit),
      summary: {
        ratingAverage: ratingAverage(listing.ratingSum, listing.ratingCount),
        ratingCount: listing.ratingCount,
      },
    };
  },

  /**
   * Attach the host's public reply to a review — ONLY the host who owns the
   * listing the review is on (default-deny). A non-owner (or wrong role) is 403;
   * a missing review is 404.
   */
  async respond(reviewId: string, hostId: string, text: string): Promise<ReviewWithRelations> {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, listing: { select: { hostId: true } } },
    });
    if (!review) {
      throw new AppError({ statusCode: 404, code: "REVIEW_NOT_FOUND", message: "Review not found" });
    }
    if (review.listing.hostId !== hostId) {
      throw new AppError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "You do not own the listing this review is on",
      });
    }
    return prisma.review.update({
      where: { id: reviewId },
      data: { hostResponse: text, hostRespondedAt: new Date() },
      include: reviewInclude,
    });
  },
};
