import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatPaise } from "@roomadda/shared";
import { publicApi } from "../../../lib/api";
import { ApproxMap } from "../../../components/ApproxMap";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await publicApi.listing(id);
  if (!data?.listing) return { title: "Listing not found" };
  const l = data.listing;
  return {
    title: `${l.alias} — PG in ${l.areaLabel}, ${l.city}`,
    description: `${l.alias}: a ${l.gender} PG in ${l.areaLabel}, ${l.city}.`,
  };
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await publicApi.listing(id);
  if (!data?.listing) notFound();

  // `data.listing` is the MASKED PublicListing — no actualName / fullAddress /
  // pincode / exact geo exists on this type. The backend enforces this for
  // unauthenticated callers; we render only what we receive.
  const l = data.listing;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">{l.alias}</h1>
      <p className="text-slate-600">
        {l.areaLabel}, {l.city} · {l.gender}
        {l.priceFromPaise !== null && (
          <span className="ml-2 font-medium text-slate-900">from {formatPaise(l.priceFromPaise)}/mo</span>
        )}
      </p>

      {l.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {l.photos.map((p) => (
            <img key={p.id} src={p.url} alt={l.alias} className="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" />
          ))}
        </div>
      )}

      {l.amenities.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {l.amenities.map((a) => (
            <span key={a} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              {a}
            </span>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Rooms</h2>
      <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {l.rooms.length > 0 ? (
          l.rooms.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-slate-900">
                  {r.name} · {r.sharingType}-sharing
                </p>
                <p className="text-sm text-slate-500">
                  {r.availableBeds} of {r.totalBeds} beds available
                </p>
              </div>
              <p className="font-semibold text-slate-900">
                {formatPaise(r.monthlyRentPaise)}
                <span className="text-sm font-normal text-slate-500">/mo</span>
              </p>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-slate-500">No rooms listed yet.</p>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Location</h2>
      <p className="text-sm text-slate-600">
        {l.areaLabel}, {l.city}
      </p>
      <div className="mt-2">
        <ApproxMap lat={l.approxLocation.lat} lng={l.approxLocation.lng} label={l.alias} />
      </div>
    </main>
  );
}
