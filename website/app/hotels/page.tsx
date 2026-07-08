import type { Metadata } from "next";
import Link from "next/link";
import { publicApi } from "../../lib/api";
import { Breadcrumb } from "../../components/Breadcrumb";
import { HotelStayPicker } from "../../components/hotels/HotelStayPicker";
import { HotelResultCard } from "../../components/hotels/HotelResultCard";

// Availability is date- and stock-sensitive, so this page is always fresh.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const city = one((await searchParams).city);
  return {
    title: city ? `Hotels in ${city}` : "Book hotels",
    description: "Find and book hotel rooms by date across India — real nightly prices and live availability.",
  };
}

export default async function HotelsSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const city = one(sp.city);
  const area = one(sp.area);
  const checkIn = one(sp.checkIn);
  const checkOut = one(sp.checkOut);
  const guests = one(sp.guests) ?? "1";
  const cursor = one(sp.cursor);

  // A real availability search needs a city + a valid date range.
  const canSearch = Boolean(city && checkIn && checkOut && checkOut > checkIn);
  const results = canSearch
    ? await publicApi.hotelSearch({ city, area, checkIn, checkOut, guests, limit: "24", cursor })
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Hotels" }]} />

      <h1 className="text-2xl font-bold text-slate-900">Book a hotel</h1>
      <p className="mt-1 mb-6 max-w-2xl text-slate-600">
        Search by city and dates. Prices and availability are live for your exact stay — the amount you pay is
        set by our server, never your browser.
      </p>

      <HotelStayPicker defaults={{ city, area, checkIn, checkOut, guests }} />

      <div className="mt-8">
        {!canSearch ? (
          <p className="text-slate-500">Enter a city and your check-in / check-out dates to see available hotels.</p>
        ) : !results || results.items.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
            No hotels have rooms available in <span className="font-medium">{city}</span> for these dates. Try
            different dates or another city.
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {results.items.length} hotel{results.items.length === 1 ? "" : "s"} · {results.nights} night
              {results.nights === 1 ? "" : "s"} · {results.checkIn} → {results.checkOut}
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.items.map((result) => (
                <HotelResultCard
                  key={result.listing.id}
                  result={result}
                  checkIn={results.checkIn}
                  checkOut={results.checkOut}
                  guests={results.guests}
                  nights={results.nights}
                />
              ))}
            </div>
            {results.nextCursor && (
              <div className="mt-6 text-center">
                <Link
                  href={`/hotels?city=${encodeURIComponent(city!)}${area ? `&area=${encodeURIComponent(area)}` : ""}&checkIn=${results.checkIn}&checkOut=${results.checkOut}&guests=${results.guests}&cursor=${encodeURIComponent(results.nextCursor)}`}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Show more hotels →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
