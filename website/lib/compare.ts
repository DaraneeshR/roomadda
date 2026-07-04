import type { PublicListing } from "@roomadda/shared";
import {
  availabilityChip,
  BADGE_META,
  formatDistance,
  formatRent,
  genderLabel,
  priceRange,
  ratingLabel,
} from "./discovery";
import { amenitiesIncludeMeals } from "./costOfLiving";
import { sharingLabel } from "./areaInsights";

/**
 * Framework-free logic for the PG compare tray + side-by-side table. Everything
 * the compare UI decides — how many PGs it holds, how the set maps to a shareable
 * URL, which attribute rows to show, and which cells DIFFER (so the table can
 * highlight them) — lives here as pure functions, unit-tested without a DOM.
 *
 * Money is server-owned: rows only SELECT + FORMAT the paise the server already
 * put on each listing/room (via the shared money helpers) — never a computed
 * charge (see /CLAUDE.md #1).
 */

/** Compare needs at least 2 to be meaningful and caps at 4 to stay legible. */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

/** Parse a compare-set from a URL/session string: trimmed, de-duped, capped. */
export function parseCompareIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

/** Serialize a compare-set for a URL/session (`id1,id2`). */
export function serializeCompareIds(ids: string[]): string {
  return ids.join(",");
}

/** Room to add another PG to the tray (below the cap). */
export function canAddToCompare(ids: string[]): boolean {
  return ids.length < COMPARE_MAX;
}

/** Enough PGs selected to render a meaningful comparison. */
export function canCompare(ids: string[]): boolean {
  return ids.length >= COMPARE_MIN;
}

/** Toggle one id in the set: remove if present, else add (unless at the cap). */
export function toggleCompareId(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (!canAddToCompare(ids)) return ids;
  return [...ids, id];
}

/** The canonical shareable URL for a compare-set. */
export function compareUrl(ids: string[]): string {
  return `/compare?ids=${encodeURIComponent(serializeCompareIds(ids))}`;
}

// ---------------------------------------------------------------------------
// Side-by-side table model. Each row derives one attribute per listing as a
// DISPLAY string plus a SIGNATURE used only for diffing (so "3 amenities" cells
// with different amenities still count as different). `diff[i]` is true when
// cell i stands out from the row's dominant value.
// ---------------------------------------------------------------------------

export interface CompareCell {
  display: string;
  /** Value compared for highlighting; defaults to `display`. */
  signature: string;
}

export interface CompareRow {
  key: string;
  label: string;
  cells: CompareCell[];
  diff: boolean[];
}

export interface CompareContext {
  /** Distance in metres per listing id, when the set came from a proximity search. */
  distanceById?: Record<string, number>;
}

/**
 * Flag the cells that DIFFER from the row's dominant value. A uniform row flags
 * nothing; an all-distinct row flags everything (there is no dominant value);
 * otherwise every cell not equal to the most common value is flagged.
 */
export function diffFlags(signatures: string[]): boolean[] {
  if (signatures.length <= 1) return signatures.map(() => false);
  const counts = new Map<string, number>();
  for (const s of signatures) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size === 1) return signatures.map(() => false); // all equal
  let mode = signatures[0]!;
  let best = 0;
  for (const [value, count] of counts) {
    if (count > best) {
      best = count;
      mode = value;
    }
  }
  if (best === 1) return signatures.map(() => true); // all distinct — no dominant value
  return signatures.map((s) => s !== mode);
}

const cell = (display: string, signature = display): CompareCell => ({ display, signature });

/** Distinct, order-stable values pulled from a listing's rooms. */
function distinct<T>(items: T[], key: (t: T) => T): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function depositCell(listing: PublicListing): CompareCell {
  const deposits = listing.rooms.map((r) => r.depositPaise).filter((p) => p > 0);
  if (deposits.length === 0) return cell("—", "none");
  const min = Math.min(...deposits);
  const max = Math.max(...deposits);
  return min === max ? cell(formatRent(min)) : cell(`${formatRent(min)} – ${formatRent(max)}`);
}

/** The attribute rows for a set of listings, each with per-cell diff flags. */
export function buildCompareRows(listings: PublicListing[], ctx: CompareContext = {}): CompareRow[] {
  const hasAnyDistance = listings.some((l) => ctx.distanceById?.[l.id] !== undefined);

  const specs: { key: string; label: string; cell: (l: PublicListing) => CompareCell }[] = [
    {
      key: "startingPrice",
      label: "Starting price",
      cell: (l) => {
        const r = priceRange(l);
        return r.fromPaise === null ? cell("On request", "none") : cell(`${formatRent(r.fromPaise)}/mo`);
      },
    },
    {
      key: "premiumPrice",
      label: "Premium price",
      cell: (l) => {
        const r = priceRange(l);
        return r.toPaise === null ? cell("—", "none") : cell(`${formatRent(r.toPaise)}/mo`);
      },
    },
    {
      key: "roomTypes",
      label: "Room types",
      cell: (l) => {
        const names = distinct(l.rooms.map((r) => r.name), (n) => n);
        return names.length ? cell(names.join(", ")) : cell("—", "none");
      },
    },
    {
      key: "sharing",
      label: "Sharing",
      cell: (l) => {
        const sharings = distinct(l.rooms.map((r) => r.sharingType), (s) => s).sort((a, b) => a - b);
        return sharings.length ? cell(sharings.map(sharingLabel).join(", ")) : cell("—", "none");
      },
    },
    { key: "deposit", label: "Deposit", cell: depositCell },
    {
      key: "amenities",
      label: "Amenities",
      cell: (l) => {
        const sorted = [...l.amenities].sort((a, b) => a.localeCompare(b));
        return cell(sorted.length ? sorted.join(", ") : "—", sorted.map((a) => a.toLowerCase()).join("|"));
      },
    },
    { key: "meals", label: "Meals", cell: (l) => cell(amenitiesIncludeMeals(l.amenities) ? "Yes" : "No") },
    { key: "gender", label: "Occupancy", cell: (l) => cell(genderLabel(l.gender)) },
    {
      key: "rating",
      label: "Rating",
      cell: (l) => {
        const label = ratingLabel(l.ratingAverage, l.ratingCount);
        return label ? cell(label, label) : cell("Not rated yet", "none");
      },
    },
    {
      key: "badges",
      label: "Trust badges",
      cell: (l) => {
        const shorts = l.badges.map((b) => BADGE_META[b.kind].short);
        return shorts.length ? cell(shorts.join(", ")) : cell("—", "none");
      },
    },
    { key: "availability", label: "Availability", cell: (l) => cell(availabilityChip(l).label, availabilityChip(l).tone) },
  ];

  if (hasAnyDistance) {
    specs.splice(specs.length - 1, 0, {
      key: "distance",
      label: "Distance",
      cell: (l) => {
        const m = ctx.distanceById?.[l.id];
        return m === undefined ? cell("—", "none") : cell(`${formatDistance(m)} away`);
      },
    });
  }

  return specs.map((spec) => {
    const cells = listings.map(spec.cell);
    return { key: spec.key, label: spec.label, cells, diff: diffFlags(cells.map((c) => c.signature)) };
  });
}
