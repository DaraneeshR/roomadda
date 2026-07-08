import Link from "next/link";
import { formatPaise, type HotelSearchResult } from "@roomadda/shared";
import { totalAvailableRooms } from "../../lib/hotel";

/**
 * A hotel search result card. Presentation ONLY, over the MASKED public listing
 * (alias + area, never the real name/address — /CLAUDE.md rule #4) plus the
 * server-owned per-category nightly price and REAL availability for the searched
 * range. The card links to the detail page carrying the dates + guests so the
 * per-category "Book" continues the same stay. No money is computed here — the
 * "from" price is the minimum server `perNightPaise`, read not derived.
 */
export function HotelResultCard({
  result,
  checkIn,
  checkOut,
  guests,
  nights,
}: {
  result: HotelSearchResult;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
}): React.ReactNode {
  const { listing, categories } = result;
  const primary = listing.photos.find((p) => p.isPrimary) ?? listing.photos[0];
  // "From" price = the cheapest category's server nightly rate (a read, not math).
  const fromPaise = categories.reduce((min, c) => Math.min(min, c.perNightPaise), Infinity);
  const freeRooms = totalAvailableRooms(result);
  const href = `/hotels/${listing.id}?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`;

  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
        {primary ? (
          // Arbitrary CDN hosts, so a plain <img> is used (CSP allows img-src https:);
          // next/image would need remotePatterns — same choice as PhotoCarousel.
          <img
            src={primary.url}
            alt={listing.alias}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">No photo</div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-700">
          🏨 Hotel
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="truncate font-semibold text-slate-900">{listing.alias}</h3>
        <p className="text-sm text-slate-500">
          {listing.areaLabel}, {listing.city}
        </p>

        <p className="mt-1 text-xs text-slate-500">
          {categories.length} room {categories.length === 1 ? "type" : "types"} ·{" "}
          <span className={freeRooms > 0 ? "text-emerald-600" : "text-slate-400"}>
            {freeRooms} room{freeRooms === 1 ? "" : "s"} free for your dates
          </span>
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="text-sm">
            <span className="text-slate-500">from </span>
            <span className="font-semibold text-slate-900">{formatPaise(fromPaise)}</span>
            <span className="text-slate-500"> /night</span>
          </p>
          <span className="text-xs text-slate-400">
            {nights} night{nights === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}
