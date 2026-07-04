import type { AreaInsights, PriceBand, PriceHistogramBin, PublicListing } from "@roomadda/shared";
import { formatRent, formatRentCompact, genderLabel, priceRange } from "./discovery";

/**
 * Framework-free presentation logic for area price insights (the SEO area guide,
 * the histogram, and the "good value" signal on a card). Everything the UI
 * *decides* from the server's cached bands lives here as pure functions so it is
 * unit-tested without a DOM and can never drift into component code.
 *
 * Money is server-owned: nothing here computes a price — it only SELECTS and
 * FORMATS the paise figures the backend already aggregated, routing every rupee
 * string through the sanctioned money helper (see /CLAUDE.md #1).
 */

/** "2-sharing" / "Private room" for a room's beds-per-room count. */
export function sharingLabel(sharingType: number): string {
  if (sharingType <= 1) return "Private room";
  return `${sharingType}-sharing`;
}

/** "₹8,000 – ₹12,000 (typ. ₹10,000)"; a single figure when the band is flat. */
export function formatBand(band: PriceBand): string {
  if (band.minPaise === band.maxPaise) return formatRent(band.minPaise);
  return `${formatRent(band.minPaise)} – ${formatRent(band.maxPaise)} (typ. ${formatRent(band.typicalPaise)})`;
}

/**
 * Is `priceFromPaise` a genuinely good deal for this area — i.e. strictly below
 * the area's TYPICAL (median) rent? Server-owned figures only; returns false when
 * either side is unknown so we never over-claim value on thin data.
 */
export function isGoodValue(priceFromPaise: number | null, insights: AreaInsights | null | undefined): boolean {
  if (priceFromPaise === null || !insights?.overall) return false;
  return priceFromPaise < insights.overall.typicalPaise;
}

/** How far below typical, e.g. "18% below the Koramangala average" (or null). */
export function goodValueLabel(priceFromPaise: number | null, insights: AreaInsights | null | undefined): string | null {
  if (!isGoodValue(priceFromPaise, insights) || priceFromPaise === null || !insights?.overall) return null;
  const pct = Math.round((1 - priceFromPaise / insights.overall.typicalPaise) * 100);
  if (pct <= 0) return null;
  return `${pct}% below the ${insights.area} typical rent`;
}

/**
 * A per-listing map of "good value" labels for the ones priced below the area's
 * typical rent — the card chip. Listings at/above typical are simply absent (no
 * chip), so we never over-claim value.
 */
export function goodValueMap(
  listings: Pick<PublicListing, "id" | "rooms" | "priceFromPaise">[],
  insights: AreaInsights | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of listings) {
    const label = goodValueLabel(priceRange(l).fromPaise, insights);
    if (label) out[l.id] = label;
  }
  return out;
}

export interface HistogramBar {
  fromPaise: number;
  toPaise: number;
  count: number;
  /** 0–100 height for a CSS bar, scaled to the tallest column (0 when empty). */
  heightPct: number;
  /** Compact axis label for the bin's lower edge, e.g. "₹8k". */
  label: string;
}

/** Scale histogram bins into CSS-ready bars (heights relative to the max count). */
export function histogramBars(bins: PriceHistogramBin[]): HistogramBar[] {
  const max = bins.reduce((m, b) => Math.max(m, b.count), 0);
  return bins.map((b) => ({
    fromPaise: b.fromPaise,
    toPaise: b.toPaise,
    count: b.count,
    heightPct: max > 0 ? Math.round((b.count / max) * 100) : 0,
    label: formatRentCompact(b.fromPaise),
  }));
}

/**
 * A plain-English summary of an area's pricing, built only from the server's
 * bands. Returns a first-class empty-state line when the area has no live
 * inventory yet — never a fabricated number.
 */
export function areaSummary(insights: AreaInsights): string {
  const { overall, listingCount, area } = insights;
  if (!overall || listingCount === 0) {
    return `We don't have enough live listings in ${area} yet to estimate a price range. Check back soon or widen your search.`;
  }
  const noun = listingCount === 1 ? "PG" : "PGs";
  const parts = [
    `Across ${listingCount} live ${noun} in ${area}, monthly rents run from ${formatRent(overall.minPaise)} to ${formatRent(overall.maxPaise)}, with a typical price around ${formatRent(overall.typicalPaise)}.`,
  ];
  const cheapestType = [...insights.byRoomType].sort((a, b) => a.band.typicalPaise - b.band.typicalPaise)[0];
  if (cheapestType) {
    parts.push(
      `${sharingLabel(cheapestType.sharingType)} options are the most affordable, typically around ${formatRent(cheapestType.band.typicalPaise)} a month.`,
    );
  }
  if (insights.byGender.length > 1) {
    const genders = insights.byGender.map((g) => genderLabel(g.gender).toLowerCase()).join(", ");
    parts.push(`Both ${genders} accommodation is available.`);
  }
  return parts.join(" ");
}
