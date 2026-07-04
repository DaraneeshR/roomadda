import { baselineFor, type CostBaseline } from "./costBaselines";
import { formatRent } from "./discovery";

/**
 * Pure cost-of-living ESTIMATOR. Given a rent (from live area/listing data) and
 * whether meals are included, it assembles a monthly-budget breakdown + a total
 * RANGE from the configurable baselines. It is deliberately labelled an estimate
 * on EVERY path: the returned object always carries `isEstimate: true` and a
 * `disclaimer` starting with "Estimate", and `estimateNote()` never omits it —
 * the component cannot render this as an exact figure.
 *
 * Money is server-owned: rent is passed in from real data; only the coarse
 * non-rent baselines are applied here, and each is widened into a range so no
 * line reads as precise. All amounts are integer paise (see /CLAUDE.md #1).
 */

/** ±15% spread applied to each baseline line so the total is honestly a range. */
const SPREAD = 0.15;

/** True when a listing's amenities imply meals are provided (drops the food line). */
export function amenitiesIncludeMeals(amenities: string[]): boolean {
  return amenities.some((a) => /food|meal|mess|tiffin|breakfast|lunch|dinner/i.test(a));
}

export interface CostInput {
  /** Cheapest live room rent for the area/listing (paise); null when unpriced. */
  rentFromPaise: number | null;
  /** Premium-tier rent (paise) when rooms span a range; defaults to rentFromPaise. */
  rentToPaise?: number | null;
  /** Whether the PG includes meals — hides the food line when true. */
  mealsIncluded: boolean;
  /** City, to pick baselines; optional. */
  city?: string | null;
  /** Override the baselines (tests / bespoke areas). */
  baseline?: CostBaseline;
}

export interface CostLine {
  key: "rent" | "food" | "transport" | "extras";
  label: string;
  fromPaise: number;
  toPaise: number;
  /** Optional context, e.g. "Included in rent" / "from live listings". */
  note?: string;
}

export interface CostEstimate {
  lines: CostLine[];
  totalFromPaise: number;
  totalToPaise: number;
  /** Human total, e.g. "₹12,000 – ₹18,000 / month". */
  totalLabel: string;
  /** Always begins with "Estimate" — this figure is never presented as exact. */
  disclaimer: string;
  /** Literal true on every path, so callers can't accidentally treat it as exact. */
  isEstimate: true;
}

const spread = (base: number): { fromPaise: number; toPaise: number } => ({
  fromPaise: Math.round(base * (1 - SPREAD)),
  toPaise: Math.round(base * (1 + SPREAD)),
});

/**
 * Build the monthly-budget estimate. Handles an unpriced area (rent line shows
 * "Price on request", contributing 0 to the range) and meals-included PGs (food
 * line shows "Included", contributing 0) — both still return a labelled estimate.
 */
export function estimateCostOfLiving(input: CostInput): CostEstimate {
  const baseline = input.baseline ?? baselineFor(input.city);
  const lines: CostLine[] = [];

  // Rent — from live data, never computed. A range when rooms span tiers.
  const rentFrom = input.rentFromPaise ?? 0;
  const rentTo = input.rentToPaise ?? input.rentFromPaise ?? 0;
  lines.push({
    key: "rent",
    label: "PG rent",
    fromPaise: rentFrom,
    toPaise: Math.max(rentFrom, rentTo),
    note: input.rentFromPaise === null ? "Price on request" : "from live listings",
  });

  // Food — only when meals are NOT bundled into rent.
  if (input.mealsIncluded) {
    lines.push({ key: "food", label: "Food", fromPaise: 0, toPaise: 0, note: "Included in rent" });
  } else {
    lines.push({ key: "food", label: "Food", ...spread(baseline.foodPerMonthPaise), note: "meals not included" });
  }

  lines.push({ key: "transport", label: "Transport", ...spread(baseline.transportPerMonthPaise), note: "commute to hubs" });
  lines.push({ key: "extras", label: "Extras", ...spread(baseline.extrasPerMonthPaise), note: "data, utilities, essentials" });

  const totalFromPaise = lines.reduce((s, l) => s + l.fromPaise, 0);
  const totalToPaise = lines.reduce((s, l) => s + l.toPaise, 0);

  return {
    lines,
    totalFromPaise,
    totalToPaise,
    totalLabel:
      totalFromPaise === totalToPaise
        ? `${formatRent(totalFromPaise)} / month`
        : `${formatRent(totalFromPaise)} – ${formatRent(totalToPaise)} / month`,
    disclaimer:
      "Estimate only — a rough monthly budget from live rents plus typical food, transport and extras. Actual costs vary by lifestyle.",
    isEstimate: true,
  };
}
