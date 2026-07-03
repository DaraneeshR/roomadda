import type { SocialProof } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { AppError } from "../../lib/errors.js";
import { socialConfig, type SocialConfig } from "./social.config.js";
import { assembleSocialProof, type SocialInputs } from "./social.logic.js";
import { createRedisPresenceStore, type PresenceStore } from "./presence.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that represent a REAL, paid booking (never an abandoned hold). A
 *  webhook-confirmed booking is CONFIRMED; a finished stay is COMPLETED. Agent
 *  bookings are ordinary Bookings, so they are already included. */
const PAID_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

/** Options every read/write accepts so config + clock are injectable in tests. */
interface SocialOpts {
  config?: SocialConfig;
  /** Wall clock in ms — injectable so the viewing-TTL window and booked-count
   *  window are deterministic under test. */
  nowMs?: number;
}

// Real Redis-backed presence for "viewing now" (distinct sessions, short TTL).
const presence: PresenceStore = createRedisPresenceStore(redis);

const listingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

/**
 * Social-proof engine — every number is REAL and honesty-gated. Live "viewing
 * now" comes from Redis presence; "booked recently" from the cron-cached count
 * of confirmed-paid bookings + walk-ins; scarcity from live bed inventory;
 * "wishlisted" from the real save count. The pure gating in social.logic decides
 * what clears its floor; below floor the field is OMITTED (see /CLAUDE.md).
 */
export const socialService = {
  /**
   * Register a presence heartbeat for a viewer of `listingId`. `sessionKey`
   * identifies the viewer (auth user id, else the client session id) so the SAME
   * viewer is counted once. The listing must exist (404 otherwise) so bogus ids
   * cannot seed Redis keys.
   */
  async heartbeat(listingId: string, sessionKey: string, opts: SocialOpts = {}): Promise<void> {
    const config = opts.config ?? socialConfig;
    const nowMs = opts.nowMs ?? Date.now();
    const exists = await prisma.pgListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!exists) throw listingNotFound();
    await presence.heartbeat(listingId, sessionKey, nowMs, config.viewingTtlSeconds);
  },

  /**
   * The honesty-gated widget object for a listing. Gathers the real signals in
   * parallel, then applies the floors. Throws 404 if the listing does not exist.
   */
  async getSocialProof(listingId: string, opts: SocialOpts = {}): Promise<SocialProof> {
    const config = opts.config ?? socialConfig;
    const nowMs = opts.nowMs ?? Date.now();

    const [listing, totalBeds, availableBeds, wishlistedCount, viewingNow] = await Promise.all([
      prisma.pgListing.findUnique({
        where: { id: listingId },
        select: { recentBookingCount: true, recentBookingWindowDays: true },
      }),
      prisma.bed.count({ where: { room: { listingId } } }),
      prisma.bed.count({ where: { room: { listingId }, status: "AVAILABLE" } }),
      prisma.wishlist.count({ where: { listingId } }),
      presence.countActive(listingId, nowMs, config.viewingTtlSeconds),
    ]);
    if (!listing) throw listingNotFound();

    const inputs: SocialInputs = {
      viewingNow,
      bookedCount: listing.recentBookingCount,
      bookedWindowDays: listing.recentBookingWindowDays,
      availableBeds,
      totalBeds,
      wishlistedCount,
    };
    return assembleSocialProof(inputs, config);
  },

  /**
   * Recompute + cache each listing's "booked recently" count from REAL activity
   * in the rolling window: CONFIRMED/COMPLETED (paid) bookings by `confirmedAt`
   * — which already includes agent-attributed bookings — PLUS host-recorded
   * walk-ins by `createdAt`. Abandoned holds (TOKEN_PENDING/EXPIRED/…) are never
   * counted. Every listing is reset first so stale counts decay to zero; the
   * whole update runs in one transaction (multi-row mutation, /CLAUDE.md). Runs
   * on a short cron, never on the read path.
   */
  async recomputeBookedCounts(opts: SocialOpts = {}): Promise<{ listingsWithActivity: number; windowDays: number }> {
    const config = opts.config ?? socialConfig;
    const nowMs = opts.nowMs ?? Date.now();
    const windowDays = config.bookedWindowDays;
    const cutoff = new Date(nowMs - windowDays * DAY_MS);
    const now = new Date(nowMs);

    const [bookings, walkIns] = await Promise.all([
      prisma.booking.groupBy({
        by: ["listingId"],
        where: { status: { in: [...PAID_BOOKING_STATUSES] }, confirmedAt: { gte: cutoff } },
        _count: { _all: true },
      }),
      prisma.walkInTenant.groupBy({
        by: ["listingId"],
        where: { createdAt: { gte: cutoff } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, number>();
    for (const row of bookings) counts.set(row.listingId, row._count._all);
    for (const row of walkIns) {
      counts.set(row.listingId, (counts.get(row.listingId) ?? 0) + row._count._all);
    }

    await prisma.$transaction([
      // Reset every listing to 0 for this window so stale counts can't linger.
      prisma.pgListing.updateMany({
        data: { recentBookingCount: 0, recentBookingWindowDays: windowDays, recentBookingCountAt: now },
      }),
      // Then write the real counts for listings with activity.
      ...[...counts].map(([listingId, count]) =>
        prisma.pgListing.update({ where: { id: listingId }, data: { recentBookingCount: count } }),
      ),
    ]);

    return { listingsWithActivity: counts.size, windowDays };
  },
};
