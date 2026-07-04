import { Prisma } from "@prisma/client";
import {
  GENDER_POLICIES,
  type AreaInsights,
  type GenderPolicy,
  type PriceBand,
  type PriceHistogramBin,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";

/**
 * Area insights — ONE cached, PUBLISHED-only price snapshot for GET
 * /v1/areas/:area/insights. This is NOT a new engine: it runs a small set of
 * GROUPED aggregate queries over the area's live listings (never materialising
 * rows) and folds them into price bands + a rent histogram. Money stays integer
 * paise, and the whole payload is Redis-cached so an SEO area page or a filter
 * histogram refreshing does not re-hit Postgres (see /CLAUDE.md).
 *
 * The band/histogram MATH is kept as pure, exported helpers so it is unit-tested
 * without a DB and can never drift.
 */

const CACHE_PREFIX = "roomadda:area-insights:v1";
const CACHE_TTL_SECONDS = 300;
/** How many columns the rent histogram tiles the [min, max] span into. */
const HISTOGRAM_BINS = 8;

/** A distinct rent and how many rooms charge it — the shape a grouped rent
 *  query returns, and the sole input to the pure band/histogram helpers. */
export interface RentCount {
  rentPaise: number;
  count: number;
}

/** 0-based value at expanded index `k` over rent→count pairs sorted ascending. */
function valueAtIndex(sorted: RentCount[], k: number): number {
  let seen = 0;
  for (const p of sorted) {
    seen += p.count;
    if (k < seen) return p.rentPaise;
  }
  // k is out of range only through a caller bug; fall back to the top value.
  return sorted[sorted.length - 1]!.rentPaise;
}

/**
 * Collapse rent→count pairs into a price band, or null when there are no priced
 * rooms. `typicalPaise` is the MEDIAN (average of the two middle rents on an even
 * sample), `avgPaise` the mean — both rounded to whole paise so no float escapes.
 */
export function bandFromCounts(pairs: RentCount[]): PriceBand | null {
  const sorted = pairs.filter((p) => p.count > 0).sort((a, b) => a.rentPaise - b.rentPaise);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((s, p) => s + p.count, 0);
  const weightedSum = sorted.reduce((s, p) => s + p.rentPaise * p.count, 0);

  const lo = valueAtIndex(sorted, Math.floor((total - 1) / 2));
  const hi = valueAtIndex(sorted, Math.floor(total / 2));

  return {
    minPaise: sorted[0]!.rentPaise,
    typicalPaise: Math.round((lo + hi) / 2),
    maxPaise: sorted[sorted.length - 1]!.rentPaise,
    avgPaise: Math.round(weightedSum / total),
    roomCount: total,
  };
}

/**
 * Tile the [min, max] rent span into `binCount` equal-width columns and count the
 * rooms in each (empty columns kept, so the histogram reads as a smooth curve).
 * A single distinct rent collapses to one column; no rooms yields [].
 */
export function histogramFromCounts(pairs: RentCount[], binCount = HISTOGRAM_BINS): PriceHistogramBin[] {
  const clean = pairs.filter((p) => p.count > 0);
  if (clean.length === 0) return [];
  const min = Math.min(...clean.map((p) => p.rentPaise));
  const max = Math.max(...clean.map((p) => p.rentPaise));
  const total = clean.reduce((s, p) => s + p.count, 0);
  if (min === max) return [{ fromPaise: min, toPaise: max, count: total }];

  const edge = (i: number): number => Math.round(min + (i * (max - min)) / binCount);
  const bins: PriceHistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    fromPaise: edge(i),
    toPaise: edge(i + 1),
    count: 0,
  }));
  for (const p of clean) {
    const idx = Math.min(binCount - 1, Math.floor(((p.rentPaise - min) / (max - min)) * binCount));
    bins[idx]!.count += p.count;
  }
  return bins;
}

/** rows from a `groupBy(['monthlyRentPaise'])` → the RentCount pairs helpers eat. */
function toPairs(rows: Array<{ monthlyRentPaise: number; _count: { _all: number } }>): RentCount[] {
  return rows.map((r) => ({ rentPaise: r.monthlyRentPaise, count: r._count._all }));
}

export const areaService = {
  /**
   * Cached price insights for one area. `area`/`city` are matched
   * case-insensitively; only PUBLISHED, non-paused listings with priced rooms
   * feed the bands. Returns the empty-but-typed shape (null bands, empty arrays)
   * when the area has no live inventory.
   */
  async getInsights(area: string, city: string | null): Promise<AreaInsights> {
    const cacheKey = `${CACHE_PREFIX}:${(city ?? "*").toLowerCase()}:${area.toLowerCase()}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as AreaInsights;

    const insights = await computeInsights(area, city);
    await redis.set(cacheKey, JSON.stringify(insights), "EX", CACHE_TTL_SECONDS);
    return insights;
  },
};

async function computeInsights(area: string, city: string | null): Promise<AreaInsights> {
  const listingWhere: Prisma.PgListingWhereInput = {
    status: "PUBLISHED",
    paused: false,
    areaLabel: { equals: area, mode: "insensitive" },
    ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
  };
  // Only priced rooms feed a band — a 0-rent placeholder room would poison min.
  const roomWhere: Prisma.RoomWhereInput = { listing: listingWhere, monthlyRentPaise: { gt: 0 } };

  // Grouped reads, run concurrently — no listing/room rows are materialised.
  // Gender lives on the listing (not a Room scalar), so it needs one grouped
  // rent query per policy; there are only three, so it stays cheap.
  const [listingCount, overallRents, byTypeRows, ...genderRents] = await Promise.all([
    prisma.pgListing.count({ where: listingWhere }),
    prisma.room.groupBy({ by: ["monthlyRentPaise"], where: roomWhere, _count: { _all: true } }),
    prisma.room.groupBy({
      by: ["sharingType", "monthlyRentPaise"],
      where: roomWhere,
      _count: { _all: true },
    }),
    ...GENDER_POLICIES.map((gender) =>
      prisma.room.groupBy({
        by: ["monthlyRentPaise"],
        where: { ...roomWhere, listing: { ...listingWhere, gender } },
        _count: { _all: true },
      }),
    ),
  ]);

  const overallPairs = toPairs(overallRents);
  const overall = bandFromCounts(overallPairs);

  const byGender: AreaInsights["byGender"] = [];
  GENDER_POLICIES.forEach((gender: GenderPolicy, i) => {
    const band = bandFromCounts(toPairs(genderRents[i]!));
    if (band) byGender.push({ gender, band });
  });

  // Fold the (sharingType, rent) grid into one band per sharing type.
  const byTypePairs = new Map<number, RentCount[]>();
  for (const row of byTypeRows) {
    const list = byTypePairs.get(row.sharingType) ?? [];
    list.push({ rentPaise: row.monthlyRentPaise, count: row._count._all });
    byTypePairs.set(row.sharingType, list);
  }
  const byRoomType: AreaInsights["byRoomType"] = [...byTypePairs.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([sharingType, pairs]) => {
      const band = bandFromCounts(pairs);
      return band ? [{ sharingType, band }] : [];
    });

  return {
    area,
    city,
    listingCount,
    roomCount: overall?.roomCount ?? 0,
    overall,
    byGender,
    byRoomType,
    histogram: histogramFromCounts(overallPairs),
    generatedAt: new Date().toISOString(),
  };
}
