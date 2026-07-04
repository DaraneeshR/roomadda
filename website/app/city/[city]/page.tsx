import type { Metadata } from "next";
import { publicApi } from "../../../lib/api";
import { filtersToQuery } from "../../../lib/discovery";
import { buildLandingContent, INTENTS, INTENT_KEYS, landingFilters, type LandingSpec } from "../../../lib/landing";
import { landmarksInCity } from "../../../lib/landmarks";
import { absoluteUrl } from "../../../lib/seo";
import { LandingPage } from "../../../components/discovery/LandingPage";

/** Intent + area + landmark cross-links for a city (internal linking / crawl). */
function relatedLinksFor(city: string): { label: string; href: string }[] {
  const c = encodeURIComponent(city);
  const intents = INTENT_KEYS.map((slug) => ({
    label: `${INTENTS[slug]!.heading} in ${city}`,
    href: `/pg/${slug}/${c}`,
  }));
  const landmarks = landmarksInCity(city);
  const areaLinks = [...new Map(landmarks.map((l) => [l.area, l])).values()].map((l) => ({
    label: `PGs in ${l.area}`,
    href: `/area/${c}/${encodeURIComponent(l.area)}`,
  }));
  const nearLinks = landmarks.map((l) => ({ label: `Near ${l.name}`, href: `/near/${c}/${l.slug}` }));
  return [...intents, ...areaLinks, ...nearLinks];
}

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const city = decodeURIComponent((await params).city);
  const content = buildLandingContent({ kind: "city", city });
  return {
    title: content.h1,
    description: content.intro,
    alternates: { canonical: absoluteUrl(content.canonicalPath) },
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const city = decodeURIComponent((await params).city);
  const spec: LandingSpec = { kind: "city", city };
  const filters = landingFilters(spec);
  const page = await publicApi.listings({ ...filtersToQuery(filters), limit: "12" }, 300);
  const content = buildLandingContent(spec);

  return (
    <LandingPage
      content={content}
      listings={page?.items ?? []}
      filters={filters}
      relatedLinks={relatedLinksFor(city)}
    />
  );
}
