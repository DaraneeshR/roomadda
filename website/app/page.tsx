import Link from "next/link";
import { publicApi } from "../lib/api";
import { ListingGrid } from "../components/ListingGrid";
import { SearchForm } from "../components/SearchForm";

export const revalidate = 60;

export default async function HomePage() {
  const featured = await publicApi.featured(8);
  const items = featured?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <section className="mb-12">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Find your next PG home</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Verified PG accommodation across India — search by city, budget, gender and sharing type.
        </p>
        <div className="mt-6">
          <SearchForm />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Travelling for a few nights?{" "}
          <Link href="/hotels" className="font-semibold text-teal-700 hover:underline">
            Book a hotel by date →
          </Link>
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-slate-900">Featured stays</h2>
        <ListingGrid listings={items} empty="No featured stays right now — try a search above." />
      </section>
    </main>
  );
}
