import type { BookingStatus } from "@prisma/client";
import { BOOKING_STATUSES, type MetricsDTO } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { env } from "../../config/env.js";

/**
 * Admin dashboard metrics — ONE cheap snapshot for GET /v1/metrics.
 *
 * Every figure comes from a grouped COUNT/SUM query (never by loading rows),
 * money stays integer paise, and the whole payload is cached in Redis for
 * CACHE_TTL_SECONDS so a 500+-user dashboard refreshing on a timer does not
 * hammer Postgres (see /CLAUDE.md).
 */

/** Cache key + TTL for the metrics snapshot. */
const CACHE_KEY = "roomadda:metrics:v1";
const CACHE_TTL_SECONDS = 30;

export const metricsService = {
  async getMetrics(): Promise<MetricsDTO> {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as MetricsDTO;

    const metrics = await computeMetrics();
    await redis.set(CACHE_KEY, JSON.stringify(metrics), "EX", CACHE_TTL_SECONDS);
    return metrics;
  },
};

async function computeMetrics(): Promise<MetricsDTO> {
  // "Settled today" = online payments captured within the rolling window.
  const settledSince = new Date(Date.now() - env.METRICS_PAYMENTS_WINDOW_HOURS * 3_600_000);

  // Six grouped reads, run concurrently — no rows are materialised.
  const [listingsByStatus, bookingsByStatus, settled, kycPending, adsPendingApproval, cashInHand] =
    await Promise.all([
      prisma.pgListing.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.paymentTransaction.aggregate({
        _sum: { amountPaise: true },
        _count: { _all: true },
        where: { status: "CAPTURED", capturedAt: { gte: settledSince } },
      }),
      prisma.kycRecord.count({ where: { status: "PENDING" } }),
      prisma.adSlot.count({ where: { status: "PENDING_APPROVAL" } }),
      // Cash-in-hand = COLLECTED but not yet RECONCILED (see admin.service cashInHand).
      prisma.cashCollection.aggregate({ _sum: { amountPaise: true }, where: { status: "COLLECTED" } }),
    ]);

  const listingsTotal = listingsByStatus.reduce((sum, g) => sum + g._count._all, 0);
  const listingsPublished = listingsByStatus.find((g) => g.status === "PUBLISHED")?._count._all ?? 0;

  // Seed every status to 0 so the client shape is stable, then fill from the group.
  const bookings = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0])) as Record<
    BookingStatus,
    number
  >;
  for (const g of bookingsByStatus) bookings[g.status] = g._count._all;

  return {
    listings: { total: listingsTotal, published: listingsPublished },
    bookings,
    payments: {
      settledCountToday: settled._count._all,
      settledPaiseToday: settled._sum.amountPaise ?? 0,
    },
    kycPending,
    adsPendingApproval,
    agentCashInHandPaise: cashInHand._sum.amountPaise ?? 0,
    generatedAt: new Date().toISOString(),
  };
}
