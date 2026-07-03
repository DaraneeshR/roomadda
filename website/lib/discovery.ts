import { paiseToRupees, type GenderPolicy, type PublicListing, type SocialProof, type TrustBadge, type TrustBadgeKind } from "@roomadda/shared";

/**
 * Framework-free presentation logic for discovery (search cards, filters, the
 * split-view map, reviews and social proof). Everything the UI *decides* — how to
 * label a badge, which social-proof signal cleared its floor, how similar two
 * listings are, how a filter set maps to a shareable URL — lives here as pure
 * functions so it is unit-tested WITHOUT a DOM (the website's vitest runs in
 * node) and can never drift into ad-hoc component code.
 *
 * Two honesty invariants are encoded here, not in components:
 *   1. Social proof renders ONLY the fields the server actually sent. The gating
 *      is done server-side (below its floor a field is OMITTED); we never invent
 *      a value, so an empty `social` object yields an empty list — nothing shows.
 *   2. Money is server-owned. Nothing here computes a charge. `priceRange` only
 *      SELECTS min/max over rents the server already put on each room, and all
 *      formatting goes through the shared money helper — never ad-hoc arithmetic.
 */

// ---------------------------------------------------------------------------
// Money display (selection + formatting only — never a computed charge).
// ---------------------------------------------------------------------------

/** Compact whole-rupee INR, e.g. "₹8,000". Display only; routes through the
 *  sanctioned paise→rupee helper (no ad-hoc money arithmetic — /CLAUDE.md #1). */
const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatRent(paise: number): string {
  return rupeeFormatter.format(paiseToRupees(paise));
}

/** Ultra-compact rent for a map pin, e.g. "₹8k" / "₹1.2L". Display only. */
export function formatRentCompact(paise: number): string {
  const rupees = paiseToRupees(paise);
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(rupees % 100_000 === 0 ? 0 : 1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(rupees % 1000 === 0 ? 0 : 1)}k`;
  return `₹${rupees}`;
}

export interface PriceRange {
  /** Lowest room rent (== the server's `priceFromPaise`); null when unpriced. */
  fromPaise: number | null;
  /** Highest room rent — the "premium" tier. Null when there is only one price
   *  (or none), so the card can show a single figure instead of a range. */
  toPaise: number | null;
}

/**
 * The card's price band: the cheapest room ("starting") and, when rooms span
 * more than one price, the priciest ("premium"). Both are SELECTED from the
 * server-provided room rents — never computed — so a range can never disagree
 * with what booking will charge.
 */
export function priceRange(listing: Pick<PublicListing, "rooms" | "priceFromPaise">): PriceRange {
  const rents = listing.rooms.map((r) => r.monthlyRentPaise).filter((p) => p > 0);
  if (rents.length === 0) return { fromPaise: listing.priceFromPaise, toPaise: null };
  const min = Math.min(...rents);
  const max = Math.max(...rents);
  return { fromPaise: min, toPaise: max > min ? max : null };
}

/** "₹8,000" or "₹8,000 – ₹12,000" (premium tier); "Price on request" when unpriced. */
export function formatPriceRange(range: PriceRange): string {
  if (range.fromPaise === null) return "Price on request";
  if (range.toPaise === null) return formatRent(range.fromPaise);
  return `${formatRent(range.fromPaise)} – ${formatRent(range.toPaise)}`;
}

// ---------------------------------------------------------------------------
// Trust badges. The server hands us `badges` already ORDERED BY PRIORITY and
// FEATURED split out; we only pick how many a card shows and how each looks.
// ---------------------------------------------------------------------------

export interface BadgeMeta {
  /** Full label (detail view). */
  label: string;
  /** Terse label for a card chip. */
  short: string;
  /** A single glyph — plain text, so no external image is loaded under the CSP. */
  icon: string;
  /** Tailwind classes for the chip. */
  className: string;
}

export const BADGE_META: Record<TrustBadgeKind, BadgeMeta> = {
  WIZARD: { label: "Wizard Host", short: "Wizard", icon: "🧙", className: "bg-violet-100 text-violet-800" },
  LUXURY: { label: "Luxury", short: "Luxury", icon: "💎", className: "bg-fuchsia-100 text-fuchsia-800" },
  RA_CHOICE: { label: "RoomAdda Choice", short: "RA Choice", icon: "🏆", className: "bg-amber-100 text-amber-800" },
  RA_ASSURED: { label: "RA Assured", short: "Assured", icon: "✅", className: "bg-emerald-100 text-emerald-800" },
  RA_VERIFIED: { label: "Verified", short: "Verified", icon: "☑️", className: "bg-sky-100 text-sky-800" },
  TRENDING: { label: "Trending", short: "Trending", icon: "🔥", className: "bg-orange-100 text-orange-800" },
  INSTANT_BOOK: { label: "Instant Book", short: "Instant", icon: "⚡", className: "bg-teal-100 text-teal-800" },
  FEATURED: { label: "Featured", short: "Featured", icon: "⭐", className: "bg-yellow-100 text-yellow-800" },
};

/**
 * The badges a CARD shows: the top `n` (default 3), taking the server's priority
 * order as-is (the serializer already sorted + dropped FEATURED). Never reorders,
 * so the "top 2–3 priority-ordered" contract stays owned by the backend.
 */
export function cardBadges(badges: TrustBadge[], n = 3): TrustBadge[] {
  return badges.slice(0, n);
}

// ---------------------------------------------------------------------------
// Social proof — HONESTY-GATED. Turn the (already floor-gated) server object
// into an ordered list of display items. Nothing sent ⇒ empty list ⇒ the UI
// renders nothing. We NEVER synthesise a value the server withheld.
// ---------------------------------------------------------------------------

export type SocialTone = "scarcity-red" | "scarcity-amber" | "booked" | "viewing" | "wishlist";

export interface SocialProofItem {
  key: keyof SocialProof;
  /** Human line, built only from real values the server sent. */
  text: string;
  tone: SocialTone;
  icon: string;
}

/**
 * Ordered social-proof items for a listing, most-urgent first (genuine scarcity →
 * recent bookings → viewing-now → wishlist saves). Only fields PRESENT on `social`
 * appear — a field the server omitted (below its floor) is simply absent, so the
 * returned list is exactly the honest set. An all-omitted `social` returns `[]`.
 */
export function socialProofItems(social: SocialProof | null | undefined): SocialProofItem[] {
  if (!social) return [];
  const items: SocialProofItem[] = [];

  if (social.bedsLeft) {
    if (social.bedsLeft.level === "red") {
      items.push({ key: "bedsLeft", text: "Fully booked right now", tone: "scarcity-red", icon: "⛔" });
    } else {
      const n = social.bedsLeft.count;
      items.push({ key: "bedsLeft", text: `Only ${n} bed${n === 1 ? "" : "s"} left`, tone: "scarcity-amber", icon: "🔥" });
    }
  }
  if (social.bookedRecently) {
    const { count, windowDays } = social.bookedRecently;
    items.push({
      key: "bookedRecently",
      text: `Booked ${count} time${count === 1 ? "" : "s"} in the last ${windowDays} days`,
      tone: "booked",
      icon: "📅",
    });
  }
  if (social.viewingNow !== undefined) {
    const n = social.viewingNow;
    items.push({ key: "viewingNow", text: `${n} ${n === 1 ? "person is" : "people are"} viewing now`, tone: "viewing", icon: "👀" });
  }
  if (social.wishlistedCount !== undefined) {
    const n = social.wishlistedCount;
    items.push({ key: "wishlistedCount", text: `${n} ${n === 1 ? "person has" : "people have"} saved this`, tone: "wishlist", icon: "❤️" });
  }

  return items;
}

/** The single strongest social signal for a compact CARD line (or null). */
export function primarySocialProof(social: SocialProof | null | undefined): SocialProofItem | null {
  return socialProofItems(social)[0] ?? null;
}

export const SOCIAL_TONE_CLASSES: Record<SocialTone, string> = {
  "scarcity-red": "text-red-600",
  "scarcity-amber": "text-orange-600",
  booked: "text-emerald-700",
  viewing: "text-teal-700",
  wishlist: "text-rose-600",
};

// ---------------------------------------------------------------------------
// Rating (stars + count), sourced from the server's cached aggregate.
// ---------------------------------------------------------------------------

export interface StarBreakdown {
  full: number;
  half: number;
  empty: number;
}

/** Split a 0–5 average into full / half / empty stars (rounded to nearest half). */
export function starBreakdown(average: number): StarBreakdown {
  const clamped = Math.max(0, Math.min(5, average));
  const halves = Math.round(clamped * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2;
  return { full, half, empty: 5 - full - half };
}

/** "4.6 (23)" for a rated listing; null when there are no reviews (empty state). */
export function ratingLabel(average: number | null, count: number): string | null {
  if (average === null || count <= 0) return null;
  return `${average.toFixed(1)} (${count})`;
}

// ---------------------------------------------------------------------------
// Availability chip.
// ---------------------------------------------------------------------------

export type AvailabilityTone = "available" | "scarce" | "full";

export interface AvailabilityChip {
  beds: number;
  label: string;
  tone: AvailabilityTone;
}

/** Live bed availability, summed from the server's per-room `availableBeds`. */
export function availabilityChip(listing: Pick<PublicListing, "rooms">): AvailabilityChip {
  const beds = listing.rooms.reduce((sum, r) => sum + r.availableBeds, 0);
  if (beds <= 0) return { beds, label: "Waitlist", tone: "full" };
  if (beds <= 2) return { beds, label: `Only ${beds} bed${beds === 1 ? "" : "s"} left`, tone: "scarce" };
  return { beds, label: `${beds} beds available`, tone: "available" };
}

export const AVAILABILITY_TONE_CLASSES: Record<AvailabilityTone, string> = {
  available: "bg-emerald-50 text-emerald-700",
  scarce: "bg-orange-50 text-orange-700",
  full: "bg-slate-100 text-slate-500",
};

// ---------------------------------------------------------------------------
// Gender + distance.
// ---------------------------------------------------------------------------

export function genderLabel(gender: GenderPolicy): string {
  const labels: Record<GenderPolicy, string> = { MALE: "Men only", FEMALE: "Women only", COED: "Co-ed" };
  return labels[gender];
}

/** Pin/marker colour by gender policy (also used for the map legend). */
export function genderColor(gender: GenderPolicy): string {
  const colors: Record<GenderPolicy, string> = { MALE: "#2563eb", FEMALE: "#db2777", COED: "#7c3aed" };
  return colors[gender];
}

/** "450 m" / "1.2 km" from a metre distance (already bucketed server-side). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 50) * 50} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// Amenities — icon preview + "+N more".
// ---------------------------------------------------------------------------

/** Substring → glyph. Plain text only (no external icon fonts under the CSP). */
const AMENITY_ICON_RULES: [test: RegExp, icon: string][] = [
  [/wifi|wi-fi|internet/i, "📶"],
  [/\bac\b|air.?con/i, "❄️"],
  [/food|meal|mess|tiffin|kitchen/i, "🍽️"],
  [/park/i, "🅿️"],
  [/laundry|washing/i, "🧺"],
  [/gym|fitness/i, "🏋️"],
  [/power.?backup|inverter|generator/i, "🔌"],
  [/cctv|security|guard/i, "🎥"],
  [/housekeep|cleaning/i, "🧹"],
  [/hot.?water|geyser|heater/i, "🚿"],
  [/lift|elevator/i, "🛗"],
  [/\btv\b|television/i, "📺"],
  [/fridge|refriger/i, "🧊"],
  [/study|desk|library/i, "📚"],
  [/ac.?power|charging/i, "🔋"],
];

export function amenityIcon(amenity: string): string {
  for (const [test, icon] of AMENITY_ICON_RULES) if (test.test(amenity)) return icon;
  return "•";
}

export interface AmenityPreview {
  shown: { name: string; icon: string }[];
  moreCount: number;
}

/** First `n` amenities as icon+name, plus how many are hidden ("+N more"). */
export function amenityPreview(amenities: string[], n = 3): AmenityPreview {
  const shown = amenities.slice(0, n).map((name) => ({ name, icon: amenityIcon(name) }));
  return { shown, moreCount: Math.max(0, amenities.length - shown.length) };
}

// ---------------------------------------------------------------------------
// Lightbox index stepping (wrap-around).
// ---------------------------------------------------------------------------

/** Step a lightbox index by `delta`, wrapping around a gallery of `length`. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((current + delta) % length + length) % length;
}

// ---------------------------------------------------------------------------
// Similar listings — client-side scoring over listings we already fetched.
// "same area → price band → gender → amenity similarity". Pure so the ranking
// is unit-tested and we can guarantee the carousel NEVER dead-ends.
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Jaccard overlap of two amenity sets (0–1). */
export function amenityOverlap(a: string[], b: string[]): number {
  const sa = new Set(a.map(normalize));
  const sb = new Set(b.map(normalize));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** How close two starting prices are, 0–1 (1 = identical, decaying with the gap). */
export function priceCloseness(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0;
  const hi = Math.max(a, b);
  if (hi === 0) return 1;
  return 1 - Math.abs(a - b) / hi;
}

/**
 * Similarity of `candidate` to `target` for the "similar PGs" carousel. Weighted:
 * same area dominates, then a close price band, then same gender, then shared
 * amenities. Higher is more similar. The target itself is expected to be filtered
 * out by the caller (a self-match would score maximally).
 */
export function scoreSimilar(target: PublicListing, candidate: PublicListing): number {
  let score = 0;
  if (normalize(candidate.city) === normalize(target.city)) score += 1.5;
  if (normalize(candidate.areaLabel) === normalize(target.areaLabel)) score += 4;
  if (candidate.gender === target.gender) score += 2;
  score += 3 * priceCloseness(priceRange(target).fromPaise, priceRange(candidate).fromPaise);
  score += 2 * amenityOverlap(target.amenities, candidate.amenities);
  return score;
}

/**
 * Rank `candidates` by similarity to `target`, dropping the target itself and any
 * duplicate ids, and return the top `n`. Deterministic: ties break by rating then
 * id so the order is stable across renders.
 */
export function rankSimilar(target: PublicListing, candidates: PublicListing[], n = 8): PublicListing[] {
  const seen = new Set<string>([target.id]);
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  return unique
    .map((c) => ({ c, s: scoreSimilar(target, c) }))
    .sort((x, y) => y.s - x.s || (y.c.ratingAverage ?? 0) - (x.c.ratingAverage ?? 0) || x.c.id.localeCompare(y.c.id))
    .slice(0, n)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Filters — the single source of truth for the filter set, its URL encoding and
// its removable chips. Superset of the app; every value maps to a real backend
// query param (see backend listFiltersSchema). Client + server both parse/emit
// through here so a shared URL always reproduces the same query.
// ---------------------------------------------------------------------------

export interface FilterState {
  city?: string;
  area?: string;
  gender?: GenderPolicy;
  sharingType?: string;
  minRentPaise?: string;
  maxRentPaise?: string;
  moveInDate?: string;
  badge?: TrustBadgeKind;
  amenities: string[];
}

const GENDERS: GenderPolicy[] = ["MALE", "FEMALE", "COED"];
const BADGES: TrustBadgeKind[] = [
  "RA_VERIFIED",
  "RA_ASSURED",
  "RA_CHOICE",
  "LUXURY",
  "WIZARD",
  "TRENDING",
  "INSTANT_BOOK",
];

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Parse a Next `searchParams` bag (or a URLSearchParams-like getter) into state. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  const gender = first(sp.gender);
  const badge = first(sp.badge);
  const amenities = first(sp.amenities);
  return {
    city: first(sp.city) || undefined,
    area: first(sp.area) || undefined,
    gender: gender && (GENDERS as string[]).includes(gender) ? (gender as GenderPolicy) : undefined,
    sharingType: first(sp.sharingType) || undefined,
    minRentPaise: first(sp.minRentPaise) || undefined,
    maxRentPaise: first(sp.maxRentPaise) || undefined,
    moveInDate: first(sp.moveInDate) || undefined,
    badge: badge && (BADGES as string[]).includes(badge) ? (badge as TrustBadgeKind) : undefined,
    amenities: amenities ? amenities.split(",").map((a) => a.trim()).filter(Boolean) : [],
  };
}

/** State → a plain query object the backend `/v1/listings` accepts (amenities csv). */
export function filtersToQuery(state: FilterState): Record<string, string> {
  const q: Record<string, string> = {};
  if (state.city) q.city = state.city;
  if (state.area) q.area = state.area;
  if (state.gender) q.gender = state.gender;
  if (state.sharingType) q.sharingType = state.sharingType;
  if (state.minRentPaise) q.minRentPaise = state.minRentPaise;
  if (state.maxRentPaise) q.maxRentPaise = state.maxRentPaise;
  if (state.moveInDate) q.moveInDate = state.moveInDate;
  if (state.badge) q.badge = state.badge;
  if (state.amenities.length > 0) q.amenities = state.amenities.join(",");
  return q;
}

/** State → a URLSearchParams for a shareable/indexable address. Stable key order. */
export function filtersToSearchParams(state: FilterState): URLSearchParams {
  return new URLSearchParams(filtersToQuery(state));
}

/** State → "/search?…" (the canonical shareable URL for this filter set). */
export function filtersToUrl(state: FilterState, path = "/search"): string {
  const qs = filtersToSearchParams(state).toString();
  return qs ? `${path}?${qs}` : path;
}

/** True when no filter is set (drives the "clear all" affordance + match copy). */
export function isFilterEmpty(state: FilterState): boolean {
  return Object.keys(filtersToQuery(state)).length === 0;
}

/** A single removable filter chip. `key` identifies exactly what `removeChip` drops. */
export interface FilterChip {
  key: string;
  label: string;
}

/** The active filters as human chips (a badge/amenity/price each removable). */
export function activeChips(state: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  if (state.city) chips.push({ key: "city", label: state.city });
  if (state.area) chips.push({ key: "area", label: state.area });
  if (state.gender) chips.push({ key: "gender", label: genderLabel(state.gender) });
  if (state.sharingType) chips.push({ key: "sharingType", label: `${state.sharingType}-sharing` });
  if (state.minRentPaise || state.maxRentPaise) {
    chips.push({ key: "rent", label: rentChipLabel(state.minRentPaise, state.maxRentPaise) });
  }
  if (state.moveInDate) chips.push({ key: "moveInDate", label: `Move-in ${state.moveInDate}` });
  if (state.badge) chips.push({ key: "badge", label: BADGE_META[state.badge].label });
  for (const a of state.amenities) chips.push({ key: `amenity:${a}`, label: a });
  return chips;
}

function rentChipLabel(minPaise?: string, maxPaise?: string): string {
  const min = minPaise ? formatRent(Number(minPaise)) : null;
  const max = maxPaise ? formatRent(Number(maxPaise)) : null;
  if (min && max) return `${min} – ${max}`;
  if (min) return `Over ${min}`;
  return `Under ${max}`;
}

/** Remove one chip, returning a NEW state. Rent removes both bounds together. */
export function removeChip(state: FilterState, key: string): FilterState {
  if (key.startsWith("amenity:")) {
    const name = key.slice("amenity:".length);
    return { ...state, amenities: state.amenities.filter((a) => a !== name) };
  }
  const next = { ...state };
  switch (key) {
    case "city":
      next.city = undefined;
      break;
    case "area":
      next.area = undefined;
      break;
    case "gender":
      next.gender = undefined;
      break;
    case "sharingType":
      next.sharingType = undefined;
      break;
    case "rent":
      next.minRentPaise = undefined;
      next.maxRentPaise = undefined;
      break;
    case "moveInDate":
      next.moveInDate = undefined;
      break;
    case "badge":
      next.badge = undefined;
      break;
  }
  return next;
}

/** Copy of state with every filter cleared (keeps the amenities array shape). */
export function clearFilters(): FilterState {
  return { amenities: [] };
}

/** Human match-count line, e.g. "12 PGs" / "1 PG" / "No PGs match". */
export function matchCountLabel(count: number, hasMore: boolean): string {
  if (count === 0) return "No PGs match";
  const plural = `${count}${hasMore ? "+" : ""} PG${count === 1 && !hasMore ? "" : "s"}`;
  return plural;
}

/**
 * A UNIQUE, human H1 + meta description for a filtered search page, so every
 * indexable filter URL has distinct, descriptive SEO text (not a generic
 * "Search PGs"). Pure so it is unit-tested and shared by the page + its metadata.
 */
export function searchHeading(filters: FilterState): { h1: string; description: string } {
  const genderWord = filters.gender ? { MALE: "Men's", FEMALE: "Women's", COED: "Co-ed" }[filters.gender] : null;
  const place = [filters.area, filters.city].filter(Boolean).join(", ");
  const noun = `${genderWord ? `${genderWord} PG` : "PG"} accommodation`;
  const h1 = place ? `${noun} in ${place}` : `${noun} across India`;
  const bits: string[] = [];
  if (filters.sharingType) bits.push(`${filters.sharingType}-sharing`);
  if (filters.badge) bits.push(BADGE_META[filters.badge].label);
  if (filters.amenities.length > 0) bits.push(`with ${filters.amenities.slice(0, 3).join(", ")}`);
  const suffix = bits.length > 0 ? ` — ${bits.join(", ")}` : "";
  return {
    h1,
    description: `Browse ${place ? `${noun.toLowerCase()} in ${place}` : `verified ${noun.toLowerCase()} across India`}${suffix}. Filter by budget, gender, sharing and trust badges.`,
  };
}

// ---------------------------------------------------------------------------
// Map — dependency-free projection + clustering. The website has a strict CSP
// (no external map script) and the backend masks geo to a coarse ~1 km marker,
// so instead of a tiled slippy map we project the result set's approx markers
// into the panel ourselves. All the math is here (pure) so it is unit-tested;
// the client component only wires pointer events on top.
// ---------------------------------------------------------------------------

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Bounding box of a set of points, padded by `pad` (fraction) so pins aren't on
 *  the edge. Returns a small default box for a single point (or none). */
export function boundsOf(points: GeoPoint[], pad = 0.15): Bounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  // Give a zero-extent axis a small span so projection doesn't divide by zero.
  const latSpan = maxLat - minLat || 0.02;
  const lngSpan = maxLng - minLng || 0.02;
  return {
    minLat: minLat - latSpan * pad,
    maxLat: maxLat + latSpan * pad,
    minLng: minLng - lngSpan * pad,
    maxLng: maxLng + lngSpan * pad,
  };
}

/** Project a lat/lng into a `width`×`height` pixel box (equirectangular; north up). */
export function project(point: GeoPoint, bounds: Bounds, width: number, height: number): { x: number; y: number } {
  const x = ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
  // Latitude increases upward, so invert the y axis.
  const y = (1 - (point.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x, y };
}

/** Inverse of `project`: a pixel back to lat/lng (for "search this area"). */
export function unproject(x: number, y: number, bounds: Bounds, width: number, height: number): { lat: number; lng: number } {
  const lng = bounds.minLng + (x / width) * (bounds.maxLng - bounds.minLng);
  const lat = bounds.minLat + (1 - y / height) * (bounds.maxLat - bounds.minLat);
  return { lat, lng };
}

export interface Cluster {
  x: number;
  y: number;
  ids: string[];
}

/**
 * Grid-cluster projected points so pins that would overlap at the current zoom
 * merge into one count bubble. `cell` is the grid size in pixels; a larger cell
 * (zoomed out) clusters more aggressively. A cluster's position is the mean of
 * its members. Deterministic ordering by first-seen id.
 */
export function clusterPoints(
  points: { id: string; x: number; y: number }[],
  cell: number,
): Cluster[] {
  if (cell <= 0) return points.map((p) => ({ x: p.x, y: p.y, ids: [p.id] }));
  const buckets = new Map<string, { sx: number; sy: number; ids: string[] }>();
  for (const p of points) {
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const b = buckets.get(key);
    if (b) {
      b.sx += p.x;
      b.sy += p.y;
      b.ids.push(p.id);
    } else {
      buckets.set(key, { sx: p.x, sy: p.y, ids: [p.id] });
    }
  }
  return [...buckets.values()].map((b) => ({ x: b.sx / b.ids.length, y: b.sy / b.ids.length, ids: b.ids }));
}

/** Metres per degree of latitude — used to turn a viewport into a search radius. */
const METERS_PER_DEG_LAT = 111_320;

/** Rough radius (metres) that covers a bounds' half-diagonal, for nearby search. */
export function boundsRadiusMeters(bounds: Bounds): number {
  const latM = ((bounds.maxLat - bounds.minLat) / 2) * METERS_PER_DEG_LAT;
  const midLat = (bounds.maxLat + bounds.minLat) / 2;
  const lngM = ((bounds.maxLng - bounds.minLng) / 2) * METERS_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  return Math.round(Math.min(10_000, Math.max(500, Math.hypot(latM, lngM))));
}
