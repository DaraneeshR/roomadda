import type { BadgeConfig } from "./badge.config.js";

/**
 * Badge kinds the ENGINE earns/maintains from rules. INSTANT_BOOK is derived live
 * on read (not stored) and FEATURED is admin-granted, so neither is a rule badge.
 */
export type RuleBadgeKind = "RA_VERIFIED" | "RA_ASSURED" | "RA_CHOICE" | "LUXURY" | "WIZARD" | "TRENDING";

export const RULE_BADGE_KINDS: readonly RuleBadgeKind[] = [
  "RA_VERIFIED",
  "RA_ASSURED",
  "RA_CHOICE",
  "LUXURY",
  "WIZARD",
  "TRENDING",
];

/** Durable badges re-evaluated NIGHTLY (everything except momentum-based Trending). */
export const DURABLE_BADGE_KINDS: readonly RuleBadgeKind[] = [
  "RA_VERIFIED",
  "RA_ASSURED",
  "RA_CHOICE",
  "LUXURY",
  "WIZARD",
];

/** Trending is re-evaluated HOURLY (momentum fades fast). */
export const TRENDING_BADGE_KINDS: readonly RuleBadgeKind[] = ["TRENDING"];

/**
 * Real signals for one listing, gathered by badge.signals. Every field is a
 * measured value from live data — ratings, inspection, chat response, bookings,
 * escalations, inventory, price percentiles. The evaluator NEVER invents any.
 */
export interface BadgeSignals {
  // RA Verified
  inspectionApproved: boolean; // an admin-APPROVED agent inspection exists
  hostKycVerified: boolean;
  // RA Assured
  listingPhotoCount: number;
  amenitiesMatched: boolean; // the approved inspection confirmed every claimed amenity
  hostResponseRate: number; // 0..1 over the response window
  unresolvedEscalations: number; // unresolved escalated service requests in the window
  // Ratings (P5.1)
  ratingAverage: number | null;
  ratingCount: number;
  // Luxury
  areaPriceTopQuartile: boolean;
  premiumAmenityCount: number;
  // Wizard
  assuredMonths: number; // how long RA_ASSURED has been continuously held
  completedStays: number;
  cancellationRate: number; // 0..1
  // RA Choice conversion
  confirmedBookingsInWindow: number;
  // Trending
  bookedThisWeek: number;
  momentumTopDecile: boolean;
}

/**
 * Evaluate which RULE badges a listing currently earns. RA_VERIFIED gates the
 * higher badges (Assured requires Verified; Choice/Luxury/Wizard require
 * Assured) — encoded by feeding each earned lower badge into the next. Trending
 * is momentum-only and independent. Pure + deterministic, so it is exhaustively
 * unit-tested (see /CLAUDE.md: tests for every service with business logic).
 */
export function evaluateBadges(s: BadgeSignals, c: BadgeConfig): Set<RuleBadgeKind> {
  const earned = new Set<RuleBadgeKind>();
  const rating = s.ratingAverage ?? 0;

  // RA Verified: agent-inspected + admin-approved + host KYC verified.
  const verified = s.inspectionApproved && s.hostKycVerified;
  if (verified) earned.add("RA_VERIFIED");

  // RA Assured: Verified + ≥8 photos + amenities matched + response ≥90% + zero
  // unresolved escalations in the window. Required before the higher badges.
  const assured =
    verified &&
    s.listingPhotoCount >= c.assuredMinPhotos &&
    s.amenitiesMatched &&
    s.hostResponseRate >= c.assuredMinResponseRate &&
    s.unresolvedEscalations === 0;
  if (assured) earned.add("RA_ASSURED");

  // RA Choice: Assured + rating ≥4.5 (with enough reviews) + real conversion +
  // fast response.
  if (
    assured &&
    s.ratingCount >= c.choiceMinReviews &&
    rating >= c.choiceMinRating &&
    s.confirmedBookingsInWindow >= c.choiceMinConfirmedBookings &&
    s.hostResponseRate >= c.choiceFastResponseRate
  ) {
    earned.add("RA_CHOICE");
  }

  // Luxury: Assured + top-quartile area price + premium amenities + rating ≥4.5.
  if (
    assured &&
    s.areaPriceTopQuartile &&
    s.premiumAmenityCount >= c.luxuryMinPremiumAmenities &&
    rating >= c.luxuryMinRating
  ) {
    earned.add("LUXURY");
  }

  // Wizard: Assured ≥6mo + ≥20 completed stays + rating ≥4.6 + <5% cancellation.
  if (
    assured &&
    s.assuredMonths >= c.wizardMinAssuredMonths &&
    s.completedStays >= c.wizardMinCompletedStays &&
    rating >= c.wizardMinRating &&
    s.cancellationRate < c.wizardMaxCancellationRate
  ) {
    earned.add("WIZARD");
  }

  // Trending (time-boxed): top-decile wishlist momentum OR booked ≥3× this week.
  if (s.momentumTopDecile || s.bookedThisWeek >= c.trendingMinBookedThisWeek) {
    earned.add("TRENDING");
  }

  return earned;
}
