import type { AreaInsights } from "@roomadda/shared";
import { type FilterState, clearFilters, formatRent } from "./discovery";
import type { Crumb } from "./seo";

/**
 * The SEO landing ENGINE (pure). It turns a structured landing spec — a city,
 * area, search intent, or nearby-landmark page — into everything a server-
 * rendered page needs: a UNIQUE H1, 200+ words of real local copy templated from
 * live area data, an FAQ set, a breadcrumb trail, the filter to fetch listings
 * with, and the canonical path. Kept framework-free so it is unit-tested and the
 * page components stay thin.
 *
 * Money is server-owned: copy only formats the price bands the backend already
 * aggregated (see /CLAUDE.md #1) — it never invents a number, and gracefully
 * omits price talk when an area has no live inventory yet.
 */

export type LandingKind = "city" | "area" | "intent" | "landmark";

export interface LandingSpec {
  kind: LandingKind;
  city: string;
  area?: string;
  intent?: string;
  /** Landmark display name (for copy/H1). */
  landmark?: string;
  /** Landmark URL slug (for the canonical path); falls back to the encoded name. */
  landmarkSlug?: string;
}

export interface IntentDef {
  slug: string;
  /** Noun phrase for the H1, e.g. "Women's PGs". */
  heading: string;
  /** Adjective woven into copy, e.g. "women-only". */
  adjective: string;
  /** Filter patch applied when fetching listings + linking to /search. */
  filter: Partial<FilterState>;
  /** Intent-specific sentence woven into the body copy. */
  blurb: string;
}

/** Search intents that get their own landing pages (`/pg/<intent>/<city>`). */
export const INTENTS: Record<string, IntentDef> = {
  womens: {
    slug: "womens",
    heading: "Women's PGs",
    adjective: "women-only",
    filter: { gender: "FEMALE" },
    blurb: "These are women-only properties, chosen with safety, security and comfort in mind.",
  },
  mens: {
    slug: "mens",
    heading: "Men's PGs",
    adjective: "men-only",
    filter: { gender: "MALE" },
    blurb: "These are men-only properties suited to students and working professionals alike.",
  },
  coed: {
    slug: "coed",
    heading: "Co-ed PGs",
    adjective: "co-ed",
    filter: { gender: "COED" },
    blurb: "These co-ed properties welcome all residents in a shared, community-style setup.",
  },
  budget: {
    slug: "budget",
    heading: "Budget PGs",
    adjective: "budget-friendly",
    filter: { maxRentPaise: "800000" },
    blurb: "We've focused on affordable rooms so you can keep your monthly outgoings in check.",
  },
  luxury: {
    slug: "luxury",
    heading: "Luxury PGs",
    adjective: "premium",
    filter: { badge: "LUXURY" },
    blurb: "Expect premium furnishings, richer amenities and a more hotel-like standard of living.",
  },
  students: {
    slug: "students",
    heading: "PGs for students",
    adjective: "student-friendly",
    filter: {},
    blurb: "Handy for students — think study-friendly rooms, meals and easy commutes to campus.",
  },
  professionals: {
    slug: "professionals",
    heading: "PGs for working professionals",
    adjective: "professional-friendly",
    filter: {},
    blurb: "Great for working professionals who want a fuss-free base near the city's work hubs.",
  },
  "instant-book": {
    slug: "instant-book",
    heading: "Instant-book PGs",
    adjective: "instant-book",
    filter: { badge: "INSTANT_BOOK" },
    blurb: "These confirm the moment your token payment clears — no waiting on a host to accept.",
  },
};

export const INTENT_KEYS = Object.keys(INTENTS);

export function getIntent(slug: string): IntentDef | undefined {
  return INTENTS[slug];
}

/** A human place label for copy: "Koramangala, Bengaluru" or just "Bengaluru". */
function placeLabel(spec: LandingSpec): string {
  return [spec.area, spec.city].filter(Boolean).join(", ");
}

/** The FilterState a landing page fetches listings with (and links to /search). */
export function landingFilters(spec: LandingSpec): FilterState {
  const base: FilterState = { ...clearFilters(), city: spec.city };
  if (spec.area) base.area = spec.area;
  const intent = spec.intent ? getIntent(spec.intent) : undefined;
  if (intent) Object.assign(base, intent.filter);
  return base;
}

export interface LandingFaq {
  q: string;
  a: string;
}

export interface LandingContent {
  h1: string;
  /** Lead sentence, also used as the meta description. */
  intro: string;
  /** Body copy — 200+ words of real, templated local guidance. */
  paragraphs: string[];
  faqs: LandingFaq[];
  breadcrumbs: Crumb[];
  canonicalPath: string;
}

function heading(spec: LandingSpec): string {
  const place = placeLabel(spec);
  switch (spec.kind) {
    case "city":
      return `PG accommodation in ${spec.city}`;
    case "area":
      return `PG accommodation in ${place}`;
    case "intent": {
      const intent = spec.intent ? getIntent(spec.intent) : undefined;
      return `${intent?.heading ?? "PGs"} in ${place}`;
    }
    case "landmark":
      return `PGs near ${spec.landmark}, ${spec.city}`;
  }
}

function priceSentence(spec: LandingSpec, insights?: AreaInsights | null): string {
  const place = placeLabel(spec);
  if (insights?.overall) {
    const { minPaise, maxPaise, typicalPaise } = insights.overall;
    return `Monthly rents in ${place} typically run from ${formatRent(minPaise)} to ${formatRent(maxPaise)}, with most rooms landing around ${formatRent(typicalPaise)} depending on the sharing type, the amenities on offer and how central the location is.`;
  }
  return `Monthly rents in ${place} vary with the sharing type, the amenities on offer and the exact location, so it is worth comparing a few shortlisted options before you commit.`;
}

function canonicalPath(spec: LandingSpec): string {
  const c = encodeURIComponent(spec.city);
  switch (spec.kind) {
    case "city":
      return `/city/${c}`;
    case "area":
      return `/area/${c}/${encodeURIComponent(spec.area ?? "")}`;
    case "intent":
      return `/pg/${spec.intent}/${c}`;
    case "landmark":
      return `/near/${c}/${spec.landmarkSlug ?? encodeURIComponent(spec.landmark ?? "")}`;
  }
}

function breadcrumbs(spec: LandingSpec): Crumb[] {
  const trail: Crumb[] = [
    { label: "Home", href: "/" },
    { label: spec.city, href: `/city/${encodeURIComponent(spec.city)}` },
  ];
  if (spec.kind === "area" && spec.area) trail.push({ label: spec.area });
  else if (spec.kind === "intent") {
    const intent = spec.intent ? getIntent(spec.intent) : undefined;
    trail.push({ label: intent?.heading ?? "PGs" });
  } else if (spec.kind === "landmark" && spec.landmark) trail.push({ label: `Near ${spec.landmark}` });
  return trail;
}

/**
 * Build the full landing content. The H1 is unique per spec and the body always
 * exceeds 200 words of genuine, product-accurate copy (verified listings, address
 * masking, token booking, JIT KYC) blended with the area's live pricing.
 */
export function buildLandingContent(spec: LandingSpec, insights?: AreaInsights | null): LandingContent {
  const place = placeLabel(spec);
  const h1 = heading(spec);
  const intent = spec.intent ? getIntent(spec.intent) : undefined;

  const focus =
    spec.kind === "intent" && intent
      ? `Looking for ${intent.adjective} paying-guest accommodation in ${place}? `
      : spec.kind === "landmark"
        ? `Searching for a PG within easy reach of ${spec.landmark} in ${spec.city}? `
        : `Looking for a comfortable paying-guest accommodation in ${place}? `;

  const intro = `${focus}RoomAdda lists verified PGs in ${place} with real photos, live bed availability and genuine resident reviews — so you can shortlist with confidence and book online in minutes.`;

  const p1 = `${intro} ${priceSentence(spec, insights)}${intent ? ` ${intent.blurb}` : ""}`;

  const p2 = `A well-run PG in ${place} bundles the essentials — a furnished bed, Wi‑Fi, housekeeping and, at many properties, home-style meals — so you can move in and get straight to work or study. Sharing options usually span private rooms through to two- and three-sharing, letting you trade a little privacy for a noticeably lower rent. Filter by budget, gender, sharing type and trust badges to narrow the list, then open any property to see its rooms, amenities, house rules and live availability at a glance.`;

  const p3 = `Every RoomAdda listing is verified before it goes live, and we show each PG's approximate area up front while keeping the exact address private until your booking is confirmed — so your privacy is protected on both sides. You reserve a bed by paying a small token online, and identity verification (KYC) is only required at that booking step, which means you can browse and compare freely without signing up first. Save your favourites, line up two to four shortlisted PGs side by side in the compare view, and check the cost-of-living estimate to budget for rent, food and transport before you decide.`;

  return {
    h1,
    intro,
    paragraphs: [p1, p2, p3],
    faqs: buildFaqs(spec, insights),
    breadcrumbs: breadcrumbs(spec),
    canonicalPath: canonicalPath(spec),
  };
}

function buildFaqs(spec: LandingSpec, insights?: AreaInsights | null): LandingFaq[] {
  const place = placeLabel(spec);
  const intent = spec.intent ? getIntent(spec.intent) : undefined;
  const faqs: LandingFaq[] = [];

  faqs.push({
    q: `How much does a PG in ${place} cost per month?`,
    a: insights?.overall
      ? `Rents typically range from ${formatRent(insights.overall.minPaise)} to ${formatRent(insights.overall.maxPaise)} a month, with a typical price around ${formatRent(insights.overall.typicalPaise)}. Private rooms cost more; higher sharing keeps the rent down.`
      : `It depends on the sharing type and amenities. Use the budget filter to see options in your price range, and open a listing to view exact room rents.`,
  });

  if (intent) {
    faqs.push({
      q: `Are these ${intent.adjective} PGs in ${place}?`,
      a: `Yes — this page is filtered to ${intent.heading.toLowerCase()} in ${place}. ${intent.blurb}`,
    });
  }

  faqs.push({
    q: `Is the exact address shown before I book?`,
    a: `No. RoomAdda shows a PG's approximate area publicly and reveals the full address only after your booking is confirmed, so both you and the host stay protected.`,
  });

  faqs.push({
    q: `What do I pay to reserve a bed?`,
    a: `You pay a small token amount online to hold the bed. The exact token is shown on each listing, and your booking is confirmed only once the payment is verified — never from an app screen alone.`,
  });

  faqs.push({
    q: `Are the listings verified?`,
    a: `Yes. Every listing is reviewed before it goes live, and trust badges such as Verified and RA Assured are earned from real signals like inspections, ratings and response rate — never bought.`,
  });

  return faqs;
}
