import Link from "next/link";
import type { PublicListing } from "@roomadda/shared";
import { ListingCard } from "../ListingCard";

/**
 * "Similar PGs" carousel. The page ranks candidates by similarity (same area →
 * price band → gender → amenities) and passes the ranked, self-excluded list.
 * This component guarantees NO DEAD END: with results it shows a horizontal
 * carousel; with none it still offers a way forward (browse more in the city).
 */
export function SimilarCarousel({
  listings,
  city,
}: {
  listings: PublicListing[];
  city: string;
}): React.ReactNode {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Similar PGs</h2>
        <Link href={`/city/${encodeURIComponent(city)}`} className="text-sm font-medium text-teal-700 hover:underline">
          More in {city} →
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Explore more options —{" "}
          <Link href={`/city/${encodeURIComponent(city)}`} className="font-medium text-teal-700 hover:underline">
            browse all PGs in {city}
          </Link>
          .
        </div>
      ) : (
        <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-2">
          {listings.map((l) => (
            <div key={l.id} className="w-64 shrink-0 snap-start">
              <ListingCard listing={l} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
