import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicListing } from "@roomadda/shared";
import { publicApi } from "../../../../lib/api";
import { goodValueMap } from "../../../../lib/areaInsights";
import { buildLandingContent, landingFilters, type LandingSpec } from "../../../../lib/landing";
import { findLandmark } from "../../../../lib/landmarks";
import { absoluteUrl } from "../../../../lib/seo";
import { LandingPage } from "../../../../components/discovery/LandingPage";

export const revalidate = 300;

/** Search radius (metres) for "near this landmark" listings. */
const NEAR_RADIUS_M = 4000;

async function resolve(params: Promise<{ city: string; landmark: string }>) {
  const { city, landmark } = await params;
  return { city: decodeURIComponent(city), landmark };
}

function specFor(city: string, landmarkSlug: string): LandingSpec | null {
  const landmark = findLandmark(city, landmarkSlug);
  if (!landmark) return null;
  return { kind: "landmark", city: landmark.city, area: landmark.area, landmark: landmark.name, landmarkSlug: landmark.slug };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; landmark: string }> }): Promise<Metadata> {
  const { city, landmark } = await resolve(params);
  const spec = specFor(city, landmark);
  if (!spec) return { title: "Location not found" };
  const content = buildLandingContent(spec);
  return {
    title: content.h1,
    description: content.intro,
    alternates: { canonical: absoluteUrl(content.canonicalPath) },
  };
}

export default async function NearLandmarkPage({ params }: { params: Promise<{ city: string; landmark: string }> }) {
  const { city, landmark: slug } = await resolve(params);
  const found = findLandmark(city, slug);
  if (!found) notFound();

  const spec: LandingSpec = { kind: "landmark", city: found.city, area: found.area, landmark: found.name, landmarkSlug: found.slug };
  const filters = landingFilters(spec);

  // Real proximity: a masked, index-backed nearby search around the landmark.
  const [insights, nearby] = await Promise.all([
    publicApi.areaInsights(found.area, found.city),
    publicApi.nearby(String(found.lat), String(found.lng), String(NEAR_RADIUS_M)),
  ]);
  const listings: PublicListing[] = nearby?.items ?? [];
  const content = buildLandingContent(spec, insights);
  const overall = insights?.overall ?? null;

  return (
    <LandingPage
      content={content}
      listings={listings}
      filters={filters}
      insights={insights}
      goodValueByListing={goodValueMap(listings, insights)}
      cost={{
        title: `Cost of living near ${found.name}`,
        rentFromPaise: overall?.minPaise ?? null,
        rentToPaise: overall?.maxPaise ?? null,
        mealsIncluded: false,
        city: found.city,
      }}
    />
  );
}
