import { describe, expect, it } from "vitest";
import type { PublicListing, TrustBadge } from "@roomadda/shared";
import { SocialProofLine, SocialProofWidgets } from "../components/discovery/SocialProof";
import { TrustBadges } from "../components/discovery/TrustBadges";
import { StarRating } from "../components/discovery/StarRating";
import { ReviewsEmptyState } from "../components/discovery/ReviewsSection";
import { SimilarCarousel } from "../components/discovery/SimilarCarousel";

/**
 * These components are hookless (server-render) presentation pieces, so they can
 * be invoked directly in the node test env and asserted on their returned element
 * tree. This locks in the two honesty rules the CARD relies on: social proof /
 * badges / rating render ONLY when real data is present — and the graceful empty
 * states for reviews and the similar carousel.
 */

/** Recursively flatten the visible text of a React element tree. */
function text(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "object" && "props" in (node as { props?: { children?: unknown } })) {
    return text((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

const badges: TrustBadge[] = [{ kind: "RA_VERIFIED", source: "RULE", earnedAt: "x", expiresAt: null }];

function listing(over: Partial<PublicListing> = {}): PublicListing {
  return {
    id: "l1",
    alias: "Sunrise PG",
    areaLabel: "Koramangala",
    city: "Bengaluru",
    gender: "COED",
    status: "PUBLISHED",
    amenities: [],
    priceFromPaise: 800000,
    instantBook: true,
    photos: [],
    rooms: [],
    ratingAverage: null,
    ratingCount: 0,
    badges: [],
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    masked: true,
    approxLocation: { lat: 12.93, lng: 77.62 },
    ...over,
  };
}

describe("card social-proof line renders only when the server sent a field", () => {
  it("is nothing below the floor (empty / undefined)", () => {
    expect(SocialProofLine({ social: {} })).toBeNull();
    expect(SocialProofLine({ social: undefined })).toBeNull();
    expect(SocialProofLine({ social: null })).toBeNull();
  });
  it("renders the strongest real signal when present", () => {
    const el = SocialProofLine({ social: { bookedRecently: { count: 3, windowDays: 30 } } });
    expect(el).not.toBeNull();
    expect(text(el)).toContain("Booked 3 times");
  });
  it("detail widgets are empty below every floor and populated above", () => {
    expect(SocialProofWidgets({ social: {} })).toBeNull();
    expect(text(SocialProofWidgets({ social: { viewingNow: 5 } }))).toContain("viewing now");
  });
});

describe("card badges + rating render only with real data", () => {
  it("no badges + not featured → nothing", () => {
    expect(TrustBadges({ badges: [] })).toBeNull();
  });
  it("renders earned badges and the featured placement", () => {
    expect(text(TrustBadges({ badges, limit: 3 }))).toContain("Verified");
    expect(text(TrustBadges({ badges: [], featured: true }))).toContain("Featured");
  });
  it("no rating for an unreviewed listing; a label when rated", () => {
    expect(StarRating({ average: null, count: 0 })).toBeNull();
    expect(text(StarRating({ average: 4.6, count: 23 }))).toContain("4.6 (23)");
  });
});

describe("graceful empty states", () => {
  it("reviews empty state offers the first-class 'no reviews yet'", () => {
    expect(text(ReviewsEmptyState())).toContain("No reviews yet");
  });

  it("similar carousel never dead-ends — a fallback when there is nothing", () => {
    const empty = SimilarCarousel({ listings: [], city: "Bengaluru" });
    expect(text(empty)).toContain("Explore more options");
    // With results it renders the carousel instead of the fallback copy.
    const withResults = SimilarCarousel({ listings: [listing({ id: "a" }), listing({ id: "b" })], city: "Bengaluru" });
    expect(text(withResults)).not.toContain("Explore more options");
  });
});
