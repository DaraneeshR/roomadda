import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicApi } from "../../../../lib/api";
import { filtersToQuery } from "../../../../lib/discovery";
import { buildLandingContent, getIntent, landingFilters, type LandingSpec } from "../../../../lib/landing";
import { absoluteUrl } from "../../../../lib/seo";
import { LandingPage } from "../../../../components/discovery/LandingPage";

export const revalidate = 300;

async function resolve(params: Promise<{ intent: string; city: string }>) {
  const { intent, city } = await params;
  return { intent, city: decodeURIComponent(city) };
}

export async function generateMetadata({ params }: { params: Promise<{ intent: string; city: string }> }): Promise<Metadata> {
  const { intent, city } = await resolve(params);
  if (!getIntent(intent)) return { title: "PGs not found" };
  const content = buildLandingContent({ kind: "intent", city, intent });
  return {
    title: content.h1,
    description: content.intro,
    alternates: { canonical: absoluteUrl(content.canonicalPath) },
  };
}

export default async function IntentLandingPage({ params }: { params: Promise<{ intent: string; city: string }> }) {
  const { intent, city } = await resolve(params);
  if (!getIntent(intent)) notFound();

  const spec: LandingSpec = { kind: "intent", city, intent };
  const filters = landingFilters(spec);
  const page = await publicApi.listings({ ...filtersToQuery(filters), limit: "12" }, 300);
  const content = buildLandingContent(spec);

  return <LandingPage content={content} listings={page?.items ?? []} filters={filters} />;
}
