import { Prisma, type ListingVisibility } from "@prisma/client";

/**
 * Listing visibility enforcement (see /CLAUDE.md domain rule #4 on masking — this
 * is the same "enforce server-side, never trust the client" stance applied to the
 * Hotel B2C add-on's distribution channel).
 *
 * A listing's `visibility` decides which surface may see it:
 *   - USER_ONLY      → consumer (B2C) surface only
 *   - CORPORATE_ONLY → corporate surface only
 *   - BOTH           → both
 *
 * Every consumer/corporate listing READ folds in the matching filter so a
 * CORPORATE_ONLY listing can NEVER appear in a B2C response (and vice-versa). This
 * is the query/serializer half of the invariant — it is never done client-side.
 *
 * Existing PG listings default to USER_ONLY, which the B2C audience always
 * includes, so wiring this in leaves current PG behaviour byte-for-byte unchanged.
 */

/** Which surface is asking. B2C = the consumer app/website; CORPORATE = the
 *  (future) corporate portal. */
export type ListingAudience = "B2C" | "CORPORATE";

/**
 * The visibilities a given audience is allowed to see. Pure so it is unit-tested.
 * B2C sees USER_ONLY + BOTH; CORPORATE sees CORPORATE_ONLY + BOTH. The two sets are
 * deliberately disjoint on the *_ONLY values, so a CORPORATE_ONLY listing is never
 * in a B2C result and a USER_ONLY listing never in a corporate one.
 */
export function visibleVisibilities(audience: ListingAudience): ListingVisibility[] {
  return audience === "B2C" ? ["USER_ONLY", "BOTH"] : ["CORPORATE_ONLY", "BOTH"];
}

/**
 * A Prisma `where` fragment restricting a listing query to `audience`. Spread this
 * into every consumer/corporate `pgListing` list query (see listing.service).
 */
export function visibilityWhere(audience: ListingAudience): Prisma.PgListingWhereInput {
  return { visibility: { in: visibleVisibilities(audience) } };
}

/**
 * A raw-SQL predicate for the same restriction, for the geography-backed `nearby`
 * query which is hand-written SQL. Values are bound parameters (never interpolated
 * — /CLAUDE.md). Compared as text so it is enum-cast-agnostic.
 */
export function visibilitySqlFilter(audience: ListingAudience): Prisma.Sql {
  const allowed = Prisma.join(visibleVisibilities(audience).map((v) => Prisma.sql`${v}`));
  return Prisma.sql`visibility::text IN (${allowed})`;
}

/**
 * May `audience` see a single listing with this `visibility`? Used by the
 * detail read, where there is no list `where` to fold the filter into. Privileged
 * viewers (owner / admin / agent) bypass this — they use `canViewPrivateListing`.
 */
export function isVisibleTo(audience: ListingAudience, visibility: ListingVisibility): boolean {
  return visibleVisibilities(audience).includes(visibility);
}
