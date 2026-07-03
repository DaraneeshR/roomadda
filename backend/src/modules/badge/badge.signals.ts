import { prisma } from "../../lib/prisma.js";
import { PREMIUM_AMENITIES, type BadgeConfig } from "./badge.config.js";
import type { BadgeSignals } from "./badge.rules.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/** Paid, real bookings (never abandoned holds) — mirrors the social engine. */
const PAID_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

/**
 * Cross-listing statistics a single listing's eligibility depends on: the
 * top-decile wishlist-momentum cohort (Trending) and each area's top-quartile
 * price threshold (Luxury). Computed ONCE per engine run and shared across every
 * listing so the per-listing pass stays cheap.
 */
export interface PopulationStats {
  momentumTopDecileIds: Set<string>;
  /** areaKey (`city|areaLabel`, lowercased) -> top-quartile starting price (paise). */
  areaPriceThreshold: Map<string, number>;
}

const areaKey = (city: string, areaLabel: string): string =>
  `${city.trim().toLowerCase()}|${areaLabel.trim().toLowerCase()}`;

/** Value at quantile q (0..1) of a numeric sample (linear interpolation). */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

export const badgeSignals = {
  /** Compute the population-level thresholds for one engine run. */
  async collectPopulationStats(config: BadgeConfig, now: Date): Promise<PopulationStats> {
    const since = new Date(now.getTime() - 7 * DAY_MS);

    // --- Trending momentum: wishlist adds in the last 7d per listing. ---
    const momentum = await prisma.wishlist.groupBy({
      by: ["listingId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = momentum.map((m) => m._count._all).filter((n) => n > 0).sort((a, b) => a - b);
    const momentumThreshold = quantile(counts, config.trendingMomentumQuantile);
    const momentumTopDecileIds = new Set<string>();
    for (const m of momentum) {
      // Require a real signal (≥1) AND at/above the decile threshold.
      if (m._count._all > 0 && m._count._all >= momentumThreshold) momentumTopDecileIds.add(m.listingId);
    }

    // --- Luxury: top-quartile starting price per area. ---
    const listings = await prisma.pgListing.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, city: true, areaLabel: true, rooms: { select: { monthlyRentPaise: true } } },
    });
    const pricesByArea = new Map<string, number[]>();
    for (const l of listings) {
      const rents = l.rooms.map((r) => r.monthlyRentPaise);
      if (rents.length === 0) continue;
      const price = Math.min(...rents);
      const key = areaKey(l.city, l.areaLabel);
      const arr = pricesByArea.get(key) ?? [];
      arr.push(price);
      pricesByArea.set(key, arr);
    }
    const areaPriceThreshold = new Map<string, number>();
    for (const [key, prices] of pricesByArea) {
      areaPriceThreshold.set(key, quantile([...prices].sort((a, b) => a - b), config.areaLuxuryQuantile));
    }

    return { momentumTopDecileIds, areaPriceThreshold };
  },

  /**
   * Gather one listing's real signals. `existingAssuredEarnedAt` is the current
   * RA_ASSURED badge's earn time (or null) so Wizard can measure how long Assured
   * has been continuously held.
   */
  async collectListingSignals(
    listingId: string,
    config: BadgeConfig,
    now: Date,
    stats: PopulationStats,
    existingAssuredEarnedAt: Date | null,
  ): Promise<BadgeSignals | null> {
    const listing = await prisma.pgListing.findUnique({
      where: { id: listingId },
      select: {
        amenities: true,
        city: true,
        areaLabel: true,
        ratingSum: true,
        ratingCount: true,
        host: { select: { kyc: { select: { status: true } } } },
        rooms: { select: { monthlyRentPaise: true } },
        _count: { select: { photos: true } },
      },
    });
    if (!listing) return null;

    const escSince = new Date(now.getTime() - config.escalationWindowDays * DAY_MS);
    const convSince = new Date(now.getTime() - config.conversionWindowDays * DAY_MS);
    const weekSince = new Date(now.getTime() - 7 * DAY_MS);

    const [approvedInspection, unresolvedEscalations, completedStays, cancelAgg, confirmedInWindow, bookedThisWeek, responseRate] =
      await Promise.all([
        prisma.propertyInspection.findFirst({
          where: { listingId, status: "APPROVED" },
          orderBy: { reviewedAt: "desc" },
          select: { amenities: true },
        }),
        prisma.serviceRequest.count({
          where: { listingId, escalated: true, status: { not: "RESOLVED" }, createdAt: { gte: escSince } },
        }),
        prisma.booking.count({ where: { listingId, status: "COMPLETED" } }),
        prisma.booking.groupBy({
          by: ["status"],
          where: { listingId, status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] } },
          _count: { _all: true },
        }),
        prisma.booking.count({
          where: { listingId, status: { in: [...PAID_STATUSES] }, confirmedAt: { gte: convSince } },
        }),
        prisma.booking.count({
          where: { listingId, status: { in: [...PAID_STATUSES] }, confirmedAt: { gte: weekSince } },
        }),
        computeResponseRate(listingId, now, config.responseWindowDays),
      ]);

    const claimed = listing.amenities.map((a) => a.trim().toLowerCase());
    const premiumAmenityCount = claimed.filter((a) => PREMIUM_AMENITIES.has(a)).length;

    const price = listing.rooms.length > 0 ? Math.min(...listing.rooms.map((r) => r.monthlyRentPaise)) : null;
    const threshold = stats.areaPriceThreshold.get(areaKey(listing.city, listing.areaLabel));
    const areaPriceTopQuartile = price !== null && threshold !== undefined && price >= threshold;

    const cancelled = cancelAgg.find((r) => r.status === "CANCELLED")?._count._all ?? 0;
    const cancelDenom = cancelAgg.reduce((sum, r) => sum + r._count._all, 0);
    const cancellationRate = cancelDenom > 0 ? cancelled / cancelDenom : 0;

    const assuredMonths = existingAssuredEarnedAt
      ? (now.getTime() - existingAssuredEarnedAt.getTime()) / MONTH_MS
      : 0;

    return {
      inspectionApproved: approvedInspection !== null,
      hostKycVerified: listing.host.kyc?.status === "VERIFIED",
      listingPhotoCount: listing._count.photos,
      amenitiesMatched: amenitiesMatched(claimed, approvedInspection?.amenities ?? null),
      hostResponseRate: responseRate,
      unresolvedEscalations,
      ratingAverage: listing.ratingCount > 0 ? listing.ratingSum / listing.ratingCount : null,
      ratingCount: listing.ratingCount,
      areaPriceTopQuartile,
      premiumAmenityCount,
      assuredMonths,
      completedStays,
      cancellationRate,
      confirmedBookingsInWindow: confirmedInWindow,
      bookedThisWeek,
      momentumTopDecile: stats.momentumTopDecileIds.has(listingId),
    };
  },
};

/**
 * Every amenity the listing CLAIMS was confirmed by the approved inspection
 * (per-amenity YES/NO/PARTIAL map). A listing claiming nothing trivially matches;
 * a missing/incomplete inspection map fails (we can't verify, so we don't award).
 */
function amenitiesMatched(claimed: string[], inspected: unknown): boolean {
  if (claimed.length === 0) return true;
  if (inspected === null || typeof inspected !== "object") return false;
  const map = inspected as Record<string, unknown>;
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.trim().toLowerCase(), String(v).toUpperCase()]));
  return claimed.every((a) => lower.get(a) === "YES");
}

/**
 * Host response rate over the window: of the listing's conversations that
 * received a tenant message, the fraction the host also replied in. No threads =
 * nothing to answer = 1.0 (a new listing isn't penalised). Real signal — it
 * drops the moment tenant inquiries go unanswered.
 */
async function computeResponseRate(listingId: string, now: Date, windowDays: number): Promise<number> {
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const conversations = await prisma.conversation.findMany({
    where: { listingId },
    select: { messages: { where: { createdAt: { gte: since } }, select: { senderRole: true } } },
  });
  let denom = 0;
  let responded = 0;
  for (const c of conversations) {
    if (!c.messages.some((m) => m.senderRole === "TENANT")) continue;
    denom += 1;
    if (c.messages.some((m) => m.senderRole === "HOST")) responded += 1;
  }
  return denom === 0 ? 1 : responded / denom;
}
