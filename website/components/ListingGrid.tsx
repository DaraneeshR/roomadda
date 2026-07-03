import type { PublicListing, SocialProof } from "@roomadda/shared";
import { ListingCard } from "./ListingCard";

/**
 * The responsive card grid used by the home, city and search pages. Pass
 * `socialByListing` to render the honesty-gated social line on cards (the browse
 * list endpoint doesn't fold social in, so it is fetched + supplied by the page
 * when wanted); omit it and cards simply show no social line.
 */
export function ListingGrid({
  listings,
  empty,
  socialByListing,
}: {
  listings: PublicListing[];
  empty?: string;
  socialByListing?: Record<string, SocialProof>;
}): React.ReactNode {
  if (listings.length === 0) {
    return <p className="py-10 text-center text-slate-500">{empty ?? "No listings found."}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} social={socialByListing?.[listing.id]} />
      ))}
    </div>
  );
}
