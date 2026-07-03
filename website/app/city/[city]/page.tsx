import type { Metadata } from "next";
import Link from "next/link";
import { publicApi } from "../../../lib/api";
import { ListingGrid } from "../../../components/ListingGrid";
import { SearchForm } from "../../../components/SearchForm";
import { Breadcrumb } from "../../../components/Breadcrumb";

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
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: name }]} />
      <h1 className="mb-2 text-2xl font-bold text-slate-900">PG accommodation in {name}</h1>
      <p className="mb-6 text-slate-600">Verified PGs in {name} — search by budget, gender and sharing.</p>
      <div className="mb-6">
        <SearchForm defaults={{ city: name }} />
      </div>
      <ListingGrid listings={items} empty={`No PGs listed in ${name} yet.`} />
      <div className="mt-8 text-center">
        <Link
          href={`/search?city=${encodeURIComponent(name)}`}
          className="inline-block rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          See all PGs in {name} with filters &amp; map →
        </Link>
      </div>
    </main>
  );
}
