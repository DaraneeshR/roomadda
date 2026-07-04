import { Prisma, type TrustTag } from "@prisma/client";
import type { AdminBadgeView, GrantBadgeInput, TrustBadgeKind } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { badgeConfig, type BadgeConfig } from "./badge.config.js";
import {
  DURABLE_BADGE_KINDS,
  TRENDING_BADGE_KINDS,
  evaluateBadges,
  type RuleBadgeKind,
} from "./badge.rules.js";
import { badgeSignals, type PopulationStats } from "./badge.signals.js";
import { isActiveBadge } from "./badge.serializer.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plain-English explanation of how each badge is earned/granted — the "why" an
 *  admin sees next to a listing's badges. Rule badges are engine-earned; FEATURED
 *  is the only admin-granted (paid) placement. */
const BADGE_WHY: Record<TrustBadgeKind, string> = {
  RA_VERIFIED: "Engine-earned: host KYC verified and an agent inspection approved.",
  RA_ASSURED: "Engine-earned: RA-Verified plus enough photos and a ≥90% host response rate.",
  RA_CHOICE: "Engine-earned: high rating, enough reviews, strong conversion and fast responses.",
  LUXURY: "Engine-earned: top-tier rating and premium amenities in a top-quartile-price area.",
  WIZARD: "Engine-earned: long-tenured Assured host with many completed stays and low cancellations.",
  TRENDING: "Engine-earned (time-boxed): booked frequently this week with top-decile momentum.",
  INSTANT_BOOK: "Derived live: Instant Book is on and a bed is available right now.",
  FEATURED: "Admin-granted paid placement (time-boxed). Never fabricated by rules.",
};

type Actor = { id: string };

interface EngineOpts {
  config?: BadgeConfig;
  now?: Date;
  /** Precomputed population stats (durable/trending jobs share one set). */
  stats?: PopulationStats;
}

const listingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

/**
 * The trust-badge engine. It EARNS badges when the real rules hold and REMOVES
 * them when they stop — badges are lost, not just gained. Admins can suspend a
 * rule badge (logged) or grant the paid FEATURED badge, but can NEVER fake-grant
 * a rule badge (guarded in {@link grant}). Nothing here trusts client input; all
 * signals are measured server-side (see badge.signals).
 */
export const badgeService = {
  /**
   * Reconcile the given rule-badge `kinds` for one listing against the current
   * rules. Creates newly-earned badges (preserving TRENDING's expiry window),
   * refreshes still-earned ones, and DELETES badges whose rules no longer hold.
   * Admin-suspended links are left untouched (the admin owns them). All writes
   * run in one transaction (multi-row mutation — /CLAUDE.md).
   */
  async reevaluateListing(
    listingId: string,
    kinds: readonly RuleBadgeKind[],
    opts: EngineOpts = {},
  ): Promise<{ earned: RuleBadgeKind[]; removed: RuleBadgeKind[] }> {
    const config = opts.config ?? badgeConfig;
    const now = opts.now ?? new Date();
    const stats = opts.stats ?? (await badgeSignals.collectPopulationStats(config, now));

    const tags = await prisma.trustTag.findMany({ where: { listingId } });
    const byKind = new Map<TrustBadgeKind, TrustTag>(tags.map((t) => [t.kind, t]));

    const assuredEarnedAt = (() => {
      const a = byKind.get("RA_ASSURED");
      return a && !a.suspended ? a.earnedAt : null;
    })();

    const signals = await badgeSignals.collectListingSignals(listingId, config, now, stats, assuredEarnedAt);
    if (!signals) throw listingNotFound();
    const earnedSet = evaluateBadges(signals, config);

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const earned: RuleBadgeKind[] = [];
    const removed: RuleBadgeKind[] = [];

    for (const kind of kinds) {
      const existing = byKind.get(kind);
      if (existing?.suspended) continue; // admin owns a suspended link

      if (earnedSet.has(kind)) {
        earned.push(kind);
        const expiresAt = kind === "TRENDING" ? new Date(now.getTime() + config.trendingTtlDays * DAY_MS) : null;
        if (existing) {
          // Refresh expiry (Trending) but PRESERVE earnedAt so Wizard's tenure clock keeps running.
          ops.push(prisma.trustTag.update({ where: { id: existing.id }, data: { expiresAt, source: "RULE" } }));
        } else {
          ops.push(
            prisma.trustTag.create({ data: { listingId, kind, source: "RULE", earnedAt: now, expiresAt } }),
          );
        }
      } else if (existing) {
        // Rules no longer hold — the badge is LOST.
        removed.push(kind);
        ops.push(prisma.trustTag.delete({ where: { id: existing.id } }));
      }
    }

    if (ops.length > 0) await prisma.$transaction(ops);
    return { earned, removed };
  },

  /** NIGHTLY: re-evaluate every durable badge for every listing. */
  async reevaluateDurableAll(opts: EngineOpts = {}): Promise<{ listings: number }> {
    return runOverAllListings(DURABLE_BADGE_KINDS, opts);
  },

  /** HOURLY: re-evaluate Trending for every listing, then sweep expired links. */
  async reevaluateTrendingAll(opts: EngineOpts = {}): Promise<{ listings: number; swept: number }> {
    const now = opts.now ?? new Date();
    const result = await runOverAllListings(TRENDING_BADGE_KINDS, { ...opts, now });
    const swept = await this.sweepExpired(now);
    return { ...result, swept };
  },

  /** Delete any expired badge link (time-boxed rule badges + lapsed FEATURED). */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const { count } = await prisma.trustTag.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  },

  // --- Admin -------------------------------------------------------------

  /**
   * Grant a badge. HARD RULE: only FEATURED (paid, admin) can be granted — a rule
   * badge is EARNED by the engine and can never be fabricated. Any other kind is
   * rejected. The placement is time-boxed by EITHER an explicit `startDate`/
   * `endDate` window (schedule ahead — inactive until start) OR `durationDays`
   * from now when no window is given.
   */
  async grant(actor: Actor, listingId: string, input: GrantBadgeInput, ip?: string): Promise<TrustTag> {
    if (input.kind !== "FEATURED") {
      throw new AppError({
        statusCode: 403,
        code: "BADGE_NOT_GRANTABLE",
        message: "Only FEATURED can be granted; rule badges are earned automatically and can never be granted",
      });
    }
    const listing = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw listingNotFound();

    const now = new Date();
    // Scheduled window when provided; otherwise start now for durationDays.
    const startsAt = input.startDate ?? null;
    const earnedAt = input.startDate ?? now;
    const expiresAt = input.endDate ?? new Date(earnedAt.getTime() + input.durationDays * DAY_MS);
    const badge = await prisma.trustTag.upsert({
      where: { listingId_kind: { listingId, kind: "FEATURED" } },
      create: { listingId, kind: "FEATURED", source: "ADMIN", earnedAt, startsAt, expiresAt },
      update: {
        source: "ADMIN",
        earnedAt,
        startsAt,
        expiresAt,
        suspended: false,
        suspendedReason: null,
        suspendedById: null,
        suspendedAt: null,
      },
    });
    await writeAudit({
      actorId: actor.id,
      action: "badge.featured.granted",
      targetId: listingId,
      ip,
      metadata: {
        startsAt: startsAt?.toISOString() ?? null,
        expiresAt: expiresAt.toISOString(),
        scheduled: Boolean(input.startDate),
      },
    });
    return badge;
  },

  /**
   * Admin view of EVERY badge link on a listing (including suspended + scheduled
   * FEATURED that a card would hide), each with its standing and a plain-English
   * "why". Read-only; a missing listing is 404.
   */
  async listForListing(listingId: string, now: Date = new Date()): Promise<AdminBadgeView[]> {
    const listing = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw listingNotFound();
    const tags = await prisma.trustTag.findMany({ where: { listingId }, orderBy: { kind: "asc" } });
    return tags.map((t) => ({
      kind: t.kind,
      source: t.source,
      earnedAt: t.earnedAt.toISOString(),
      startsAt: t.startsAt?.toISOString() ?? null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      suspended: t.suspended,
      suspendedReason: t.suspendedReason,
      active: isActiveBadge(t, now),
      why: BADGE_WHY[t.kind],
    }));
  },

  /**
   * Suspend a badge link with a logged reason. The link is retained (audit) but
   * hidden by the serializer, and the engine will not re-earn/duplicate it.
   */
  async suspend(actor: Actor, listingId: string, kind: TrustBadgeKind, reason: string, ip?: string): Promise<TrustTag> {
    const existing = await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId, kind } } });
    if (!existing) throw new AppError({ statusCode: 404, code: "BADGE_NOT_FOUND", message: "Badge not found" });

    const updated = await prisma.trustTag.update({
      where: { id: existing.id },
      data: { suspended: true, suspendedReason: reason, suspendedById: actor.id, suspendedAt: new Date() },
    });
    await writeAudit({
      actorId: actor.id,
      action: "badge.suspended",
      targetId: listingId,
      ip,
      metadata: { kind, reason },
    });
    return updated;
  },

  /** Lift a suspension (the engine may re-earn it on the next run). */
  async unsuspend(actor: Actor, listingId: string, kind: TrustBadgeKind, ip?: string): Promise<TrustTag> {
    const existing = await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId, kind } } });
    if (!existing) throw new AppError({ statusCode: 404, code: "BADGE_NOT_FOUND", message: "Badge not found" });

    const updated = await prisma.trustTag.update({
      where: { id: existing.id },
      data: { suspended: false, suspendedReason: null, suspendedById: null, suspendedAt: null },
    });
    await writeAudit({ actorId: actor.id, action: "badge.unsuspended", targetId: listingId, ip, metadata: { kind } });
    return updated;
  },
};

/** Reconcile the given kinds across every listing; returns how many were seen. */
async function runOverAllListings(
  kinds: readonly RuleBadgeKind[],
  opts: EngineOpts,
): Promise<{ listings: number }> {
  const config = opts.config ?? badgeConfig;
  const now = opts.now ?? new Date();
  const stats = opts.stats ?? (await badgeSignals.collectPopulationStats(config, now));

  const listings = await prisma.pgListing.findMany({ select: { id: true } });
  for (const { id } of listings) {
    try {
      await badgeService.reevaluateListing(id, kinds, { config, now, stats });
    } catch (err) {
      logger.error({ err, listingId: id }, "badge reevaluation failed for listing");
    }
  }
  return { listings: listings.length };
}
