import type { Metadata } from "next";
import { publicApi } from "../../../lib/api";
import { ListingGrid } from "../../../components/ListingGrid";
import { SearchForm } from "../../../components/SearchForm";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const name = decodeURIComponent(city);
  return {
    title: `PG accommodation in ${name}`,
    description: `Browse verified PG accommodation in ${name}. Filter by budget, gender and sharing type.`,
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const name = decodeURIComponent(city);
  const page = await publicApi.listings({ city: name, limit: "12" }, 60);
  const items = page?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">PG accommodation in {name}</h1>
      <p className="mb-6 text-slate-600">Verified PGs in {name} — search by budget, gender and sharing.</p>
      <div className="mb-6">
        <SearchForm defaults={{ city: name }} />
      </div>
      <ListingGrid listings={items} empty={`No PGs listed in ${name} yet.`} />
    </main>
  );
}
