/**
 * Configurable baselines for the cost-of-living ESTIMATE. These are deliberately
 * coarse, editable assumptions (never live prices): typical monthly spend on food
 * when a PG does NOT include meals, a rough commute-to-hubs transport figure, and
 * a catch-all "extras" line (data, utilities top-ups, laundry, essentials).
 *
 * Everything is integer paise (see /CLAUDE.md #1). Rent is NEVER baked in here —
 * it comes from live area/listing data; only the non-rent lines are baselined,
 * and each is turned into a RANGE by the estimator so nothing reads as exact.
 */
export interface CostBaseline {
  /** Typical monthly food spend when meals are NOT included in rent. */
  foodPerMonthPaise: number;
  /** Rough monthly commute cost to the city's common work/study hubs. */
  transportPerMonthPaise: number;
  /** Data, utility top-ups, laundry, essentials — a rough catch-all. */
  extrasPerMonthPaise: number;
}

/** National fallback used when a city has no specific override. */
export const DEFAULT_BASELINE: CostBaseline = {
  foodPerMonthPaise: 450_000, // ~₹4,500
  transportPerMonthPaise: 150_000, // ~₹1,500
  extrasPerMonthPaise: 250_000, // ~₹2,500
};

/**
 * Per-city overrides (metros run pricier on food + commute). Keyed by the same
 * city label the listings carry; matched case-insensitively. Partial — any field
 * left out falls back to {@link DEFAULT_BASELINE}.
 */
export const CITY_BASELINES: Record<string, Partial<CostBaseline>> = {
  mumbai: { foodPerMonthPaise: 600_000, transportPerMonthPaise: 250_000, extrasPerMonthPaise: 300_000 },
  bengaluru: { foodPerMonthPaise: 550_000, transportPerMonthPaise: 220_000, extrasPerMonthPaise: 300_000 },
  "bangalore": { foodPerMonthPaise: 550_000, transportPerMonthPaise: 220_000, extrasPerMonthPaise: 300_000 },
  pune: { foodPerMonthPaise: 480_000, transportPerMonthPaise: 180_000, extrasPerMonthPaise: 270_000 },
  hyderabad: { foodPerMonthPaise: 470_000, transportPerMonthPaise: 180_000, extrasPerMonthPaise: 260_000 },
  delhi: { foodPerMonthPaise: 520_000, transportPerMonthPaise: 200_000, extrasPerMonthPaise: 290_000 },
  gurugram: { foodPerMonthPaise: 560_000, transportPerMonthPaise: 240_000, extrasPerMonthPaise: 300_000 },
  chennai: { foodPerMonthPaise: 460_000, transportPerMonthPaise: 170_000, extrasPerMonthPaise: 250_000 },
};

/** The baseline for a city (defaults merged with any override). Case-insensitive. */
export function baselineFor(city?: string | null): CostBaseline {
  const override = city ? CITY_BASELINES[city.trim().toLowerCase()] : undefined;
  return { ...DEFAULT_BASELINE, ...(override ?? {}) };
}
