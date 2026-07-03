import Link from "next/link";
import type { PublicListing, SocialProof } from "@roomadda/shared";
import {
  amenityPreview,
  availabilityChip,
  AVAILABILITY_TONE_CLASSES,
  formatDistance,
  formatPriceRange,
  genderLabel,
  priceRange,
} from "../lib/discovery";
import { WishlistHeart } from "./wishlist/WishlistHeart";
import { PhotoCarousel } from "./discovery/PhotoCarousel";
import { StarRating } from "./discovery/StarRating";
import { TrustBadges } from "./discovery/TrustBadges";
import { SocialProofLine } from "./discovery/SocialProof";

/**
 * The discovery card. Presentation ONLY, over the masked public listing plus the
 * real trust/rating/social engines:
 *   • photo carousel (styled fallback, never a broken image) + wishlist heart
 *   • top 2–3 priority-ordered trust badges (order owned by the serializer)
 *   • rating stars + count (nothing when unreviewed)
 *   • starting + premium price band (selected from server rents, never computed)
 *   • amenity icons + "+N more", gender tag, live availability chip
 *   • the honesty-gated social-proof line — rendered ONLY when the server sent a
 *     field (`social` is optional; absent/empty ⇒ nothing renders).
 * `distanceMeters` is shown when the card comes from a proximity search.
 */
export function ListingCard({
  listing,
  social,
  distanceMeters,
}: {
  listing: PublicListing;
  social?: SocialProof | null;
  distanceMeters?: number;
}): React.ReactNode {
  const range = priceRange(listing);
  const amenities = amenityPreview(listing.amenities, 3);
  const availability = availabilityChip(listing);

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <PhotoCarousel
        photos={listing.photos}
        alias={listing.alias}
        overlay={
          <>
            <WishlistHeart listingId={listing.id} />
            {(listing.badges.length > 0 || listing.featured) && (
              <div className="absolute left-2 top-2 max-w-[75%]">
                <TrustBadges badges={listing.badges} featured={listing.featured} limit={3} />
              </div>
            )}
          </>
        }
      />

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900">{listing.alias}</h3>
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
            {genderLabel(listing.gender)}
          </span>
        </div>

        <p className="text-sm text-slate-500">
          {listing.areaLabel}, {listing.city}
          {distanceMeters !== undefined && (
            <span className="text-slate-400"> · {formatDistance(distanceMeters)} away</span>
          )}
        </p>

        <div className="min-h-[1.25rem]">
          <StarRating average={listing.ratingAverage} count={listing.ratingCount} />
        </div>

        {amenities.shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            {amenities.shown.map((a) => (
              <span key={a.name} className="inline-flex items-center gap-1" title={a.name}>
                <span aria-hidden>{a.icon}</span>
                <span className="max-w-[7rem] truncate">{a.name}</span>
              </span>
            ))}
            {amenities.moreCount > 0 && <span className="text-slate-400">+{amenities.moreCount} more</span>}
          </div>
        )}

        <SocialProofLine social={social} />

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="text-sm">
            <span className="font-semibold text-slate-900">{formatPriceRange(range)}</span>
            {range.fromPaise !== null && <span className="text-slate-500"> /mo</span>}
          </p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${AVAILABILITY_TONE_CLASSES[availability.tone]}`}>
            {availability.label}
          </span>
        </div>
      </div>
    </Link>
  );
}
