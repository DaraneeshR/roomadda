import type { Metadata } from "next";
import { publicApi } from "../../../../lib/api";
import { goodValueMap } from "../../../../lib/areaInsights";
import { filtersToQuery } from "../../../../lib/discovery";
import { buildLandingContent, landingFilters, type LandingSpec } from "../../../../lib/landing";
import { absoluteUrl } from "../../../../lib/seo";
import { LandingPage } from "../../../../components/discovery/LandingPage";

// SEO landing pages are statically rendered and periodically revalidated.
export const revalidate = 300;

async function resolve(params: Promise<{ city: string; area: string }>) {
  const { city, area } = await params;
  return { city: decodeURIComponent(city), area: decodeURIComponent(area) };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; area: string }> }): Promise<Metadata> {
  const { city, area } = await resolve(params);
  const content = buildLandingContent({ kind: "area", city, area });
  return {
    title: content.h1,
    description: content.intro,
    alternates: { canonical: absoluteUrl(content.canonicalPath) },
  };
}

export default async function AreaLandingPage({ params }: { params: Promise<{ city: string; area: string }> }) {
  const { city, area } = await resolve(params);
  const spec: LandingSpec = { kind: "area", city, area };
  const filters = landingFilters(spec);

  const [insights, page] = await Promise.all([
    publicApi.areaInsights(area, city),
    publicApi.listings({ ...filtersToQuery(filters), limit: "12" }, 300),
  ]);
  const content = buildLandingContent(spec, insights);
  const overall = insights?.overall ?? null;
  const listings = page?.items ?? [];

  return (
    <LandingPage
      content={content}
      listings={listings}
      filters={filters}
      insights={insights}
      goodValueByListing={goodValueMap(listings, insights)}
      cost={{
        title: `Cost of living in ${area}`,
        rentFromPaise: overall?.minPaise ?? null,
        rentToPaise: overall?.maxPaise ?? null,
        mealsIncluded: false,
        city,
      }}
    />
  );
}
