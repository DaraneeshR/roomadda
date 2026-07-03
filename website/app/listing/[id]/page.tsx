import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatPaise, type PublicListing } from "@roomadda/shared";
import { publicApi } from "../../../lib/api";
import { formatPriceRange, genderLabel, priceRange, rankSimilar } from "../../../lib/discovery";
import { listingJsonLd } from "../../../lib/seo";
import { ApproxMap } from "../../../components/ApproxMap";
import { BookingFlow } from "../../../components/booking/BookingFlow";
import { Breadcrumb } from "../../../components/Breadcrumb";
import { JsonLd } from "../../../components/JsonLd";
import { StarRating } from "../../../components/discovery/StarRating";
import { TrustBadges } from "../../../components/discovery/TrustBadges";
import { SocialProofWidgets } from "../../../components/discovery/SocialProof";
import { PhotoGridLightbox } from "../../../components/discovery/PhotoGridLightbox";
import { ReviewsSection } from "../../../components/discovery/ReviewsSection";
import { SimilarCarousel } from "../../../components/discovery/SimilarCarousel";
import { ViewingHeartbeat } from "../../../components/discovery/ViewingHeartbeat";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await publicApi.listing(id);
  if (!data?.listing) return { title: "Listing not found" };
  const l = data.listing;
  const rating = l.ratingCount > 0 && l.ratingAverage !== null ? ` · ${l.ratingAverage.toFixed(1)}★ (${l.ratingCount})` : "";
  return {
    title: `${l.alias} — PG in ${l.areaLabel}, ${l.city}`,
    description: `${l.alias}: a ${genderLabel(l.gender)} PG in ${l.areaLabel}, ${l.city}${rating}. ${formatPriceRange(priceRange(l))}/mo.`,
  };
}

/** Gather + rank candidates for the "similar PGs" carousel so it never dead-ends. */
async function similarListings(target: PublicListing): Promise<PublicListing[]> {
  const [area, city] = await Promise.all([
    publicApi.listings({ city: target.city, area: target.areaLabel, limit: "12" }, 60),
    publicApi.listings({ city: target.city, limit: "12" }, 60),
  ]);
  let candidates: PublicListing[] = [...(area?.items ?? []), ...(city?.items ?? [])];
  // Last resort so the carousel is never empty: fall back to featured stays.
  if (candidates.filter((c) => c.id !== target.id).length < 4) {
    const featured = await publicApi.featured(8);
    candidates = [...candidates, ...(featured?.items ?? [])];
  }
  return rankSimilar(target, candidates, 8);
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, reviews] = await Promise.all([publicApi.listing(id), publicApi.reviews(id, { limit: "5" }, 30)]);
  if (!data?.listing) notFound();

  // `data.listing` is the MASKED PublicListing — no actualName / fullAddress /
  // pincode / exact geo exists on this type. The backend enforces this for
  // unauthenticated callers; we render only what we receive. `data.social` is the
  // honesty-gated widget object (only fields that cleared their floor).
  const l = data.listing;
  const social = data.social;
  const similar = await similarListings(l);
  const range = priceRange(l);
  const reviewsPage = reviews ?? { items: [], nextCursor: null, summary: { ratingAverage: l.ratingAverage, ratingCount: l.ratingCount } };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <ViewingHeartbeat listingId={l.id} />
      <JsonLd data={listingJsonLd(l)} />

      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: l.city, href: `/city/${encodeURIComponent(l.city)}` },
          { label: l.areaLabel, href: `/search?city=${encodeURIComponent(l.city)}&area=${encodeURIComponent(l.areaLabel)}` },
          { label: l.alias },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">{l.alias}</h1>
          <p className="mt-1 text-slate-600">
            {l.areaLabel}, {l.city} · {genderLabel(l.gender)}
            {range.fromPaise !== null && (
              <span className="ml-2 font-medium text-slate-900">from {formatPriceRange(range)}/mo</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StarRating average={l.ratingAverage} count={l.ratingCount} size="md" />
            <TrustBadges badges={l.badges} featured={l.featured} size="md" />
          </div>
        </div>
        {/* Book fully on the web — token paid here, confirmed only by the webhook. */}
        <BookingFlow listing={l} />
      </div>

      {/* Honesty-gated social proof — only fields the server actually sent. */}
      <div className="mt-4">
        <SocialProofWidgets social={social} />
      </div>

      <PhotoGridLightbox photos={l.photos} alias={l.alias} />

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

      <ReviewsSection listingId={l.id} initial={reviewsPage} />

      <SimilarCarousel listings={similar} city={l.city} />
    </main>
  );
}
