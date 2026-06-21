import Link from "next/link";
import { formatPaise, type PublicListing } from "@roomadda/shared";

export function ListingCard({ listing }: { listing: PublicListing }) {
  const primary = listing.photos.find((p) => p.isPrimary) ?? listing.photos[0];
  const beds = listing.rooms.reduce((sum, r) => sum + r.availableBeds, 0);

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="aspect-[4/3] w-full bg-gradient-to-br from-teal-100 to-slate-200">
        {primary ? (
          // Arbitrary CDN hosts; plain <img> avoids configuring next/image remotePatterns.
          <img src={primary.url} alt={listing.alias} className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900">{listing.alias}</h3>
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
            {listing.gender}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {listing.areaLabel}, {listing.city}
        </p>
        <p className="pt-1 text-sm">
          <span className="font-semibold text-slate-900">
            {listing.priceFromPaise !== null ? formatPaise(listing.priceFromPaise) : "Price on request"}
          </span>
          {listing.priceFromPaise !== null && <span className="text-slate-500"> /mo onwards</span>}
        </p>
        <p className="text-xs text-slate-500">{beds > 0 ? `${beds} bed(s) available` : "Waitlist"}</p>
      </div>
    </Link>
  );
}
