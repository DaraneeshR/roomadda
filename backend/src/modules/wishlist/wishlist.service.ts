import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { listingInclude, type ListingWithRelations } from "../listing/serializer.js";
import type { WishlistQuery } from "./wishlist.schema.js";

/**
 * Per-user saved listings. Every method is scoped to the calling userId — a user
 * only ever reads/writes their OWN wishlist. The same rows back the app and the
 * web tenant account (one record, one source of truth — see /CLAUDE.md).
 */
export const wishlistService = {
  /** Save a listing (idempotent). Only PUBLISHED listings can be saved. */
  async add(userId: string, listingId: string): Promise<void> {
    const listing = await prisma.pgListing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true },
    });
    if (!listing || listing.status !== "PUBLISHED") {
      throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
    }
    // Saving twice is a no-op (the (userId, listingId) unique key).
    await prisma.wishlist.upsert({
      where: { userId_listingId: { userId, listingId } },
      create: { userId, listingId },
      update: {},
    });
  },

  /** Remove a saved listing (idempotent — removing a non-saved one is a no-op). */
  async remove(userId: string, listingId: string): Promise<void> {
    await prisma.wishlist.deleteMany({ where: { userId, listingId } });
  },

  /** The caller's saved listings, newest first, cursor-paginated. */
  async list(userId: string, query: WishlistQuery): Promise<Page<ListingWithRelations>> {
    const rows = await prisma.wishlist.findMany({
      where: { userId },
      include: { listing: { include: listingInclude } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map((w) => w.listing), nextCursor: page.nextCursor };
  },
};
