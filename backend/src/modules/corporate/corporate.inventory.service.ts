import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { listingInclude, toPublicListing, type ListingWithRelations } from "../listing/serializer.js";
import { visibilityWhere } from "../listing/visibility.js";
import type { PublicListing } from "@roomadda/shared";

/**
 * Corporate inventory read — the CORPORATE side of the H0 visibility invariant.
 *
 * H0 only WIRED the B2C side (listing.service uses visibilityWhere("B2C")). This is
 * its mirror: every corporate-context listing read folds in visibilityWhere("CORPORATE"),
 * so a CORPORATE_ONLY listing is reachable HERE and (by the disjoint audience sets in
 * visibility.ts) NEVER in a B2C response. The two directions are proven in
 * corporate.integration.test.ts.
 *
 * The listing is still returned MASKED (toPublicListing) — the corporate portal is a
 * distribution channel, not an entitlement to a property's real name/geo; that is
 * unlocked only by a CONFIRMED stay, exactly like B2C (/CLAUDE.md domain rule #4).
 */

export interface CorporateInventoryFilters {
  city?: string;
  area?: string;
  limit: number;
  cursor?: string;
}

export const corporateInventoryService = {
  /**
   * PUBLISHED, non-paused listings visible to the CORPORATE channel (visibility
   * CORPORATE_ONLY | BOTH), cursor-paginated. Masked public shape.
   */
  async listCorporateInventory(filters: CorporateInventoryFilters): Promise<Page<PublicListing>> {
    const where: Prisma.PgListingWhereInput = {
      status: "PUBLISHED",
      paused: false,
      // The corporate half of the visibility invariant (server-side, never client).
      ...visibilityWhere("CORPORATE"),
    };
    if (filters.city) where.city = { equals: filters.city, mode: "insensitive" };
    if (filters.area) where.areaLabel = { contains: filters.area, mode: "insensitive" };

    const rows = await prisma.pgListing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const page: Page<ListingWithRelations> = toPage(rows, filters.limit);
    return { items: page.items.map(toPublicListing), nextCursor: page.nextCursor };
  },
};
