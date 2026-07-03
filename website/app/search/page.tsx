import type { Metadata } from "next";
import Link from "next/link";
import type { Page, PublicListing } from "@roomadda/shared";
import { publicApi } from "../../lib/api";
import { filtersToQuery, filtersToUrl, parseFilters, searchHeading } from "../../lib/discovery";
import { Breadcrumb } from "../../components/Breadcrumb";
import { DiscoveryView } from "../../components/discovery/DiscoveryView";

// Filters live in the URL, so each combination is its own indexable page.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const filters = parseFilters(await searchParams);
  const { h1, description } = searchHeading(filters);
  return { title: h1, description };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const cursor = one(sp.cursor);
  const view = one(sp.view) === "split" ? "split" : "list";
  const { h1, description } = searchHeading(filters);

  const query = { ...filtersToQuery(filters), limit: "24", ...(cursor ? { cursor } : {}) };
  const page: Page<PublicListing> = (await publicApi.listings(query, 30)) ?? { items: [], nextCursor: null };

  // Crawlable "next page" URL (used by the noscript pagination + rel=next).
  const nextUrl = page.nextCursor
    ? `${filtersToUrl(filters)}${filtersToUrl(filters).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(page.nextCursor)}`
    : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          ...(filters.city ? [{ label: filters.city, href: `/city/${encodeURIComponent(filters.city)}` }] : []),
          { label: "Search" },
        ]}
      />

      <h1 className="text-2xl font-bold text-slate-900">{h1}</h1>
      <p className="mt-1 mb-6 max-w-3xl text-slate-600">{description}</p>

      <DiscoveryView
        initial={page}
        initialFilters={filters}
        initialView={view}
      />

      {/* Crawlable pagination for no-JS clients / crawlers (the client view uses
          "Load more"). Each cursor URL is a distinct, indexable page. */}
      {nextUrl && (
        <noscript>
          <div className="mt-6 text-center">
            <Link href={nextUrl} rel="next" className="rounded-md border border-slate-300 px-4 py-2 text-sm">
              Next page →
            </Link>
          </div>
        </noscript>
      )}
    </main>
  );
}
