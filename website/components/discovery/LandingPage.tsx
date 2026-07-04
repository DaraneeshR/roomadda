import Link from "next/link";
import type { AreaInsights, PublicListing } from "@roomadda/shared";
import { filtersToUrl, type FilterState } from "../../lib/discovery";
import type { LandingContent } from "../../lib/landing";
import { faqJsonLd, itemListJsonLd } from "../../lib/seo";
import { Breadcrumb } from "../Breadcrumb";
import { ListingGrid } from "../ListingGrid";
import { JsonLd } from "../JsonLd";
import { AreaInsightsPanel } from "./AreaInsightsPanel";
import { CostOfLivingPanel } from "./CostOfLivingPanel";

/**
 * The shared server-rendered shell for every SEO landing page (city / area /
 * intent / near-landmark). It renders a unique H1, the templated 200+-word copy,
 * a crawlable breadcrumb, live filtered listings, an FAQ, and the JSON-LD
 * (Breadcrumb + FAQPage + ItemList) — all server-side, so the page is fully
 * indexable with no client JS required. The optional insights + cost-of-living
 * panels light up on area pages.
 */
export interface LandingCostConfig {
  rentFromPaise: number | null;
  rentToPaise?: number | null;
  mealsIncluded: boolean;
  city?: string | null;
  title?: string;
}

export function LandingPage({
  content,
  listings,
  filters,
  insights,
  cost,
  relatedLinks,
  goodValueByListing,
}: {
  content: LandingContent;
  listings: PublicListing[];
  filters: FilterState;
  insights?: AreaInsights | null;
  cost?: LandingCostConfig | null;
  /** Internal cross-links (intents, areas, landmarks) for crawlability. */
  relatedLinks?: { label: string; href: string }[];
  /** Per-listing "good value" chip labels (from area insights). */
  goodValueByListing?: Record<string, string>;
}): React.ReactNode {
  const seeAll = filtersToUrl(filters);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb items={content.breadcrumbs} />
      <JsonLd data={faqJsonLd(content.faqs)} />
      <JsonLd data={itemListJsonLd(listings, content.h1)} />

      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{content.h1}</h1>

      <div className="mt-3 max-w-3xl space-y-3 text-slate-600">
        {content.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {(insights || cost) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {insights && <AreaInsightsPanel insights={insights} />}
          {cost && (
            <CostOfLivingPanel
              title={cost.title ?? "Cost of living"}
              rentFromPaise={cost.rentFromPaise}
              rentToPaise={cost.rentToPaise}
              mealsIncluded={cost.mealsIncluded}
              city={cost.city}
              defaultOpen
            />
          )}
        </div>
      )}

      <div className="mt-8 mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{content.h1}</h2>
        <Link href={seeAll} className="shrink-0 text-sm font-semibold text-teal-700 hover:underline">
          See all with filters &amp; map →
        </Link>
      </div>
      <ListingGrid
        listings={listings}
        goodValueByListing={goodValueByListing}
        empty="No PGs listed here just yet — check back soon or widen your search."
      />

      {relatedLinks && relatedLinks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Popular searches</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {relatedLinks.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-teal-300 hover:text-teal-700"
              >
                {r.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-slate-900">Frequently asked questions</h2>
        <dl className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {content.faqs.map((f) => (
            <div key={f.q} className="p-4">
              <dt className="font-medium text-slate-900">{f.q}</dt>
              <dd className="mt-1 text-sm text-slate-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
