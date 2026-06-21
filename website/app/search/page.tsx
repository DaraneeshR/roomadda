import Link from "next/link";
import { paiseToRupees } from "@roomadda/shared";
import { publicApi } from "../../lib/api";
import { ListingGrid } from "../../components/ListingGrid";
import { SearchForm, type SearchDefaults } from "../../components/SearchForm";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const params = {
    city: one(sp.city),
    area: one(sp.area),
    gender: one(sp.gender),
    sharingType: one(sp.sharingType),
    minRentPaise: one(sp.minRentPaise),
    maxRentPaise: one(sp.maxRentPaise),
    cursor: one(sp.cursor),
    limit: "12",
  };

  const page = await publicApi.listings(params, 30);
  const items = page?.items ?? [];

  const defaults: SearchDefaults = {
    city: params.city,
    area: params.area,
    gender: params.gender,
    sharingType: params.sharingType,
    minRent: params.minRentPaise ? String(paiseToRupees(Number(params.minRentPaise))) : "",
    maxRent: params.maxRentPaise ? String(paiseToRupees(Number(params.maxRentPaise))) : "",
  };

  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "cursor" && key !== "limit") nextParams.set(key, value);
  }
  if (page?.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Search PGs</h1>
      <div className="mb-6">
        <SearchForm defaults={defaults} />
      </div>
      <ListingGrid listings={items} empty="No PGs match your filters." />
      {page?.nextCursor && (
        <div className="mt-6 text-center">
          <Link
            href={`/search?${nextParams.toString()}`}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Next page →
          </Link>
        </div>
      )}
    </main>
  );
}
