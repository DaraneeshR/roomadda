import type { PublicListing } from "@roomadda/shared";

/**
 * SEO helpers. Pure builders for the structured data (JSON-LD) the discovery
 * pages emit, kept out of components so they are unit-testable and the absolute
 * URLs stay consistent. The site origin mirrors `metadataBase` in the root layout.
 */
export const SITE_URL = "https://roomadda.example";

export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** schema.org BreadcrumbList for a trail of crumbs (absolute item URLs). */
export function breadcrumbJsonLd(items: Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: absoluteUrl(c.href) } : {}),
    })),
  };
}

/**
 * schema.org structured data for a listing detail page. Uses only the masked
 * public fields (alias, area, city, price band, rating aggregate) — never the
 * real name or address, which the backend withholds from public callers.
 */
export function listingJsonLd(listing: PublicListing): Record<string, unknown> {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Accommodation",
    name: listing.alias,
    url: absoluteUrl(`/listing/${listing.id}`),
    address: { "@type": "PostalAddress", addressLocality: listing.areaLabel, addressRegion: listing.city, addressCountry: "IN" },
  };
  if (listing.priceFromPaise !== null) {
    data.priceRange = "₹₹";
    data.offers = {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (listing.priceFromPaise / 100).toFixed(0),
      availability: listing.rooms.some((r) => r.availableBeds > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
    };
  }
  if (listing.ratingAverage !== null && listing.ratingCount > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: listing.ratingAverage.toFixed(1),
      reviewCount: listing.ratingCount,
      bestRating: 5,
    };
  }
  return data;
}
