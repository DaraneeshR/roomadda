import type { TrustTag } from "@prisma/client";
import type { TrustBadge, TrustBadgeKind } from "@roomadda/shared";
import { BADGE_PRIORITY } from "./badge.config.js";

/**
 * Badge serialization for the listing shape. A badge link is shown only when it
 * is genuinely ACTIVE — not admin-suspended and not past its expiry — so a lost
 * or hidden badge never leaks onto a card. FEATURED is split out (styled
 * separately); INSTANT_BOOK is derived live from availability. Pure so the
 * priority ordering + active-filter are unit-tested.
 */

/** Active = not admin-suspended AND not expired. */
export function isActiveBadge(tag: { suspended: boolean; expiresAt: Date | null }, now: Date): boolean {
  if (tag.suspended) return false;
  if (tag.expiresAt !== null && tag.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Order by card priority (highest first). Stable for equal priorities. */
export function sortByPriority<T extends { kind: TrustBadgeKind }>(badges: T[]): T[] {
  return [...badges].sort((a, b) => BADGE_PRIORITY[a.kind] - BADGE_PRIORITY[b.kind]);
}

/** Cards render only the top N by priority; the detail view passes all of them. */
export function topBadges<T>(badges: T[], n = 3): T[] {
  return badges.slice(0, n);
}

export interface BadgeViewInput {
  tags: Pick<TrustTag, "kind" | "source" | "earnedAt" | "expiresAt" | "suspended">[];
  /** host-enabled Instant Book AND a live AVAILABLE bed exists. */
  instantBookEligible: boolean;
  now: Date;
}

/**
 * Build the listing's badge view: active stored badges (minus FEATURED) plus the
 * live-derived INSTANT_BOOK, ordered by priority; and whether the listing holds
 * an active FEATURED placement (surfaced separately).
 */
export function buildBadgeView(input: BadgeViewInput): { badges: TrustBadge[]; featured: boolean } {
  const active = input.tags.filter((t) => isActiveBadge(t, input.now));
  const featured = active.some((t) => t.kind === "FEATURED");

  const badges: TrustBadge[] = active
    .filter((t) => t.kind !== "FEATURED")
    .map((t) => ({
      kind: t.kind,
      source: t.source,
      earnedAt: t.earnedAt.toISOString(),
      expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    }));

  // INSTANT_BOOK is never stored — it is only true while a bed is genuinely
  // bookable right now.
  if (input.instantBookEligible) {
    badges.push({
      kind: "INSTANT_BOOK",
      source: "RULE",
      earnedAt: input.now.toISOString(),
      expiresAt: null,
    });
  }

  return { badges: sortByPriority(badges), featured };
}
