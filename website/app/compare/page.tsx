import type { Metadata } from "next";
import type { PublicListing } from "@roomadda/shared";
import { publicApi } from "../../lib/api";
import { parseCompareIds } from "../../lib/compare";
import { Breadcrumb } from "../../components/Breadcrumb";
import { CompareTable } from "../../components/compare/CompareTable";

// The set lives in the URL (shareable). Each ?ids= combination is its own view,
// but a user-built compare set is not indexable — keep it out of search results.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare PGs",
  description: "Compare PG accommodation side by side — price, room types, deposit, amenities, meals, ratings and more.",
  robots: { index: false, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function ComparePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ids = parseCompareIds(one((await searchParams).ids));

  // Fetch each PG's public shape (order preserved; failed loads are dropped).
  const results = await Promise.all(ids.map((id) => publicApi.listing(id)));
  const listings: PublicListing[] = results.flatMap((r) => (r?.listing ? [r.listing] : []));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Compare" }]} />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Compare PGs</h1>
      <p className="mb-6 text-slate-600">Side-by-side on the things that matter — price, rooms, deposit, amenities, meals and trust.</p>
      <CompareTable listings={listings} initialIds={ids} />
    </main>
  );
}
