import type { PublicListing } from "@roomadda/shared";
import { ListingCard } from "./ListingCard";

export function ListingGrid({ listings, empty }: { listings: PublicListing[]; empty?: string }) {
  if (listings.length === 0) {
    return <p className="py-10 text-center text-slate-500">{empty ?? "No listings found."}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
