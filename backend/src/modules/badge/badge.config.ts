import type { TrustBadgeKind } from "@roomadda/shared";

/**
 * Trust-badge rule thresholds (PRD §trust). Centralised + typed so the pure rule
 * evaluator is fully unit-testable with arbitrary thresholds; the engine + jobs
 * use {@link badgeConfig}. No number here is a display value — these are the
 * REAL eligibility bars a listing must clear to earn each badge.
 */
export interface BadgeConfig {
  // RA-Assured
  assuredMinPhotos: number;
  assuredMinResponseRate: number;
  // RA Choice
  choiceMinRating: number;
  choiceMinReviews: number;
  choiceMinConfirmedBookings: number; // conversion proxy over the window
  choiceFastResponseRate: number;
  // Luxury
  luxuryMinRating: number;
  luxuryMinPremiumAmenities: number;
  areaLuxuryQuantile: number; // top-quartile price for the area
  // Wizard
  wizardMinRating: number;
  wizardMinCompletedStays: number;
  wizardMinAssuredMonths: number;
  wizardMaxCancellationRate: number;
  // Trending (time-boxed)
  trendingMinBookedThisWeek: number;
  trendingTtlDays: number;
  trendingMomentumQuantile: number; // top-decile wishlist momentum
  // Windows (days)
  escalationWindowDays: number;
  responseWindowDays: number;
  conversionWindowDays: number;
}

export const badgeConfig: BadgeConfig = {
  assuredMinPhotos: 8,
  assuredMinResponseRate: 0.9,
  choiceMinRating: 4.5,
  choiceMinReviews: 5,
  choiceMinConfirmedBookings: 3,
  choiceFastResponseRate: 0.95,
  luxuryMinRating: 4.5,
  luxuryMinPremiumAmenities: 2,
  areaLuxuryQuantile: 0.75,
  wizardMinRating: 4.6,
  wizardMinCompletedStays: 20,
  wizardMinAssuredMonths: 6,
  wizardMaxCancellationRate: 0.05,
  trendingMinBookedThisWeek: 3,
  trendingTtlDays: 7,
  trendingMomentumQuantile: 0.9,
  escalationWindowDays: 90,
  responseWindowDays: 90,
  conversionWindowDays: 90,
};

/**
 * Amenities that count toward the Luxury "premium amenities" bar (canonical,
 * lowercased; common synonyms folded in). Compared case-insensitively against a
 * listing's freeform amenity strings.
 */
export const PREMIUM_AMENITIES = new Set<string>([
  "ac",
  "air conditioning",
  "gym",
  "swimming pool",
  "pool",
  "housekeeping",
  "power backup",
  "covered parking",
  "cctv",
  "lift",
  "elevator",
  "hot water",
  "geyser",
]);

/**
 * Card priority — lower number = higher priority (rendered first). Cards show the
 * top 2–3; the detail view shows all. FEATURED is styled SEPARATELY (never in the
 * earned `badges` list), so it sorts last defensively.
 */
export const BADGE_PRIORITY: Record<TrustBadgeKind, number> = {
  WIZARD: 1,
  LUXURY: 2,
  RA_CHOICE: 3,
  RA_ASSURED: 4,
  RA_VERIFIED: 5,
  TRENDING: 6,
  INSTANT_BOOK: 7,
  FEATURED: 99,
};
