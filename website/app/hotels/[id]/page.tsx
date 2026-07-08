import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { HotelCategoryAvailability } from "@roomadda/shared";
import { publicApi } from "../../../lib/api";
import { ApproxMap } from "../../../components/ApproxMap";
import { Breadcrumb } from "../../../components/Breadcrumb";
import { HotelStayPicker } from "../../../components/hotels/HotelStayPicker";
import { HotelBookPanel } from "../../../components/hotels/HotelBookPanel";

// Availability is per-date + stock-sensitive → never cache the detail read.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
/** Whole nights between two ISO dates — a day count for display, never a price. */
function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await publicApi.listing(id);
  if (!data?.listing) return { title: "Hotel not found" };
  const l = data.listing;
  return {
    title: `${l.alias} — hotel in ${l.areaLabel}, ${l.city}`,
    description: `Book ${l.alias}, a hotel in ${l.areaLabel}, ${l.city}. Live nightly prices and availability.`,
  };
}

export default async function HotelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // The MASKED shell (alias + area only — never the real name/address). The public
  // listing read returns a USER_ONLY hotel to a B2C caller; masking is server-side.
  const data = await publicApi.listing(id);
  if (!data?.listing) notFound();
  const l = data.listing;

  // Resolve the stay window (default: tonight → tomorrow).
  const today = isoDate(new Date());
  const checkIn = one(sp.checkIn) ?? today;
  const rawCheckOut = one(sp.checkOut) ?? addDays(checkIn, 1);
  const checkOut = rawCheckOut > checkIn ? rawCheckOut : addDays(checkIn, 1);
  const guests = Math.max(1, Number(one(sp.guests) ?? "1") || 1);
  const nights = nightsBetween(checkIn, checkOut);

  // Overlay real availability + server price for these dates. Search by city, then
  // pick THIS listing (area `contains` could drop an edge match; the id is exact).
  const search = await publicApi.hotelSearch({ city: l.city, checkIn, checkOut, guests: String(guests) });
  const result = search?.items.find((i) => i.listing.id === id);
  const categories: HotelCategoryAvailability[] = result?.categories ?? [];
  const resolvedNights = search?.nights ?? nights;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Hotels", href: "/hotels" },
          { label: l.city, href: `/hotels?city=${encodeURIComponent(l.city)}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}` },
          { label: l.alias },
        ]}
      />

      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900">{l.alias}</h1>
        <p className="mt-1 text-slate-600">
          🏨 {l.areaLabel}, {l.city}
        </p>
      </div>

      {/* Photos (masked listing photos are public URLs). */}
      {l.photos.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {l.photos.slice(0, 6).map((p) => (
            // Plain <img> (CSP allows img-src https:) — same choice as PhotoCarousel.
            <img
              key={p.id}
              src={p.url}
              alt={l.alias}
              className="aspect-[4/3] w-full rounded-lg object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {l.amenities.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Amenities</h2>
          <div className="flex flex-wrap gap-2">
            {l.amenities.map((a) => (
              <span key={a} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Your stay</h2>
          <p className="mb-3 text-sm text-slate-500">
            Change your dates to see live nightly prices and availability.
          </p>
          <HotelStayPicker
            basePath={`/hotels/${id}`}
            lockLocation
            defaults={{ checkIn, checkOut, guests: String(guests) }}
          />

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Location</h2>
          <p className="text-sm text-slate-600">
            {l.areaLabel}, {l.city}
          </p>
          <div className="mt-2">
            <ApproxMap lat={l.approxLocation.lat} lng={l.approxLocation.lng} label={l.alias} />
          </div>
        </div>

        {/* Booking (client) — server-owned price + KYC gate + hold. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <HotelBookPanel
            categories={categories}
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            nights={resolvedNights}
          />
        </div>
      </div>
    </main>
  );
}
