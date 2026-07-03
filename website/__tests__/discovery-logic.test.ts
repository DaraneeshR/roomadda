import { describe, expect, it } from "vitest";
import type { PublicListing, PublicRoom, SocialProof, TrustBadge } from "@roomadda/shared";
import {
  activeChips,
  amenityOverlap,
  amenityPreview,
  availabilityChip,
  boundsOf,
  boundsRadiusMeters,
  cardBadges,
  clearFilters,
  clusterPoints,
  filtersToQuery,
  filtersToSearchParams,
  filtersToUrl,
  formatPriceRange,
  formatRentCompact,
  isFilterEmpty,
  matchCountLabel,
  parseFilters,
  priceCloseness,
  priceRange,
  primarySocialProof,
  project,
  rankSimilar,
  ratingLabel,
  removeChip,
  scoreSimilar,
  searchHeading,
  socialProofItems,
  starBreakdown,
  stepIndex,
  unproject,
  type FilterState,
} from "../lib/discovery";

function room(rent: number, available = 3, total = 4): PublicRoom {
  return {
    id: `r${rent}-${available}`,
    name: `Room ${rent}`,
    floor: 1,
    sharingType: 2,
    monthlyRentPaise: rent,
    depositPaise: rent,
    tokenAmountPaise: rent,
    totalBeds: total,
    availableBeds: available,
  };
}

function listing(over: Partial<PublicListing> = {}): PublicListing {
  return {
    id: "l1",
    alias: "Sunrise PG",
    areaLabel: "Koramangala",
    city: "Bengaluru",
    gender: "COED",
    status: "PUBLISHED",
    amenities: ["WiFi", "AC", "Food"],
    priceFromPaise: 800000,
    instantBook: true,
    photos: [],
    rooms: [room(800000)],
    ratingAverage: 4.6,
    ratingCount: 23,
    badges: [],
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    masked: true,
    approxLocation: { lat: 12.93, lng: 77.62 },
    ...over,
  };
}

describe("price band (selected from server rents, never computed)", () => {
  it("shows a single price when all rooms match", () => {
    const r = priceRange(listing({ rooms: [room(800000), room(800000)], priceFromPaise: 800000 }));
    expect(r).toEqual({ fromPaise: 800000, toPaise: null });
    expect(formatPriceRange(r)).toBe("₹8,000");
  });

  it("shows a starting–premium range when rooms differ", () => {
    const r = priceRange(listing({ rooms: [room(800000), room(1200000)], priceFromPaise: 800000 }));
    expect(r).toEqual({ fromPaise: 800000, toPaise: 1200000 });
    expect(formatPriceRange(r)).toBe("₹8,000 – ₹12,000");
  });

  it("falls back to price-on-request when unpriced", () => {
    expect(formatPriceRange(priceRange(listing({ rooms: [], priceFromPaise: null })))).toBe("Price on request");
  });

  it("compacts rent for a map pin", () => {
    expect(formatRentCompact(800000)).toBe("₹8k");
    expect(formatRentCompact(1250000)).toBe("₹12.5k");
    expect(formatRentCompact(15000000)).toBe("₹1.5L");
  });
});

describe("trust badges — card takes the server's top N as-is", () => {
  const badges: TrustBadge[] = [
    { kind: "WIZARD", source: "RULE", earnedAt: "x", expiresAt: null },
    { kind: "LUXURY", source: "RULE", earnedAt: "x", expiresAt: null },
    { kind: "RA_CHOICE", source: "RULE", earnedAt: "x", expiresAt: null },
    { kind: "TRENDING", source: "RULE", earnedAt: "x", expiresAt: null },
  ];
  it("keeps order and caps to N without reordering", () => {
    expect(cardBadges(badges, 3).map((b) => b.kind)).toEqual(["WIZARD", "LUXURY", "RA_CHOICE"]);
  });
});

describe("social proof — honesty gate", () => {
  it("renders NOTHING when the server sent nothing (below every floor)", () => {
    expect(socialProofItems({})).toEqual([]);
    expect(socialProofItems(undefined)).toEqual([]);
    expect(socialProofItems(null)).toEqual([]);
    expect(primarySocialProof({})).toBeNull();
  });

  it("shows only the fields the server actually sent", () => {
    const social: SocialProof = { bookedRecently: { count: 4, windowDays: 30 } };
    const items = socialProofItems(social);
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe("bookedRecently");
    expect(items[0]?.text).toContain("Booked 4 times in the last 30 days");
  });

  it("orders genuine scarcity first and distinguishes amber/red", () => {
    const red = socialProofItems({ bedsLeft: { count: 0, level: "red" }, viewingNow: 9 });
    expect(red[0]?.tone).toBe("scarcity-red");
    expect(red[0]?.text).toBe("Fully booked right now");
    const social: SocialProof = { bedsLeft: { count: 2, level: "amber" }, wishlistedCount: 12 };
    const amber = socialProofItems(social);
    expect(amber[0]?.tone).toBe("scarcity-amber");
    expect(amber[0]?.text).toBe("Only 2 beds left");
    expect(primarySocialProof(social)).toEqual(amber[0]);
  });
});

describe("rating stars + label", () => {
  it("splits an average into full/half/empty", () => {
    expect(starBreakdown(4.6)).toEqual({ full: 4, half: 1, empty: 0 });
    expect(starBreakdown(5)).toEqual({ full: 5, half: 0, empty: 0 });
    expect(starBreakdown(0)).toEqual({ full: 0, half: 0, empty: 5 });
    expect(starBreakdown(3.25)).toEqual({ full: 3, half: 1, empty: 1 });
  });
  it("has no label for an unreviewed listing (empty state, never 0)", () => {
    expect(ratingLabel(null, 0)).toBeNull();
    expect(ratingLabel(4.6, 23)).toBe("4.6 (23)");
  });
});

describe("availability chip", () => {
  it("labels plenty / scarce / waitlist", () => {
    expect(availabilityChip({ rooms: [room(1, 5)] }).tone).toBe("available");
    expect(availabilityChip({ rooms: [room(1, 1)] }).tone).toBe("scarce");
    expect(availabilityChip({ rooms: [room(1, 0)] }).tone).toBe("full");
    expect(availabilityChip({ rooms: [room(1, 0)] }).label).toBe("Waitlist");
  });
});

describe("amenity preview", () => {
  it("shows the first N with icons and a +N more", () => {
    const p = amenityPreview(["WiFi", "AC", "Food", "Parking", "Gym"], 3);
    expect(p.shown.map((s) => s.name)).toEqual(["WiFi", "AC", "Food"]);
    expect(p.moreCount).toBe(2);
    expect(p.shown[0]?.icon).toBe("📶");
  });
});

describe("lightbox / carousel index stepping", () => {
  it("wraps around", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("similar listings — same area → price → gender → amenities", () => {
  const target = listing({ id: "t", areaLabel: "Koramangala", gender: "FEMALE", amenities: ["WiFi", "AC"], rooms: [room(800000)] });
  const sameArea = listing({ id: "a", areaLabel: "Koramangala", gender: "FEMALE", amenities: ["WiFi", "AC"], rooms: [room(820000)] });
  const otherArea = listing({ id: "b", areaLabel: "Indiranagar", gender: "MALE", amenities: ["Gym"], rooms: [room(2000000)] });

  it("scores same-area higher than a different area", () => {
    expect(scoreSimilar(target, sameArea)).toBeGreaterThan(scoreSimilar(target, otherArea));
  });

  it("excludes the target itself and dedupes ids", () => {
    const ranked = rankSimilar(target, [target, sameArea, sameArea, otherArea]);
    expect(ranked.map((l) => l.id)).toEqual(["a", "b"]);
    expect(ranked.find((l) => l.id === "t")).toBeUndefined();
  });

  it("returns empty only when there is genuinely nothing else (caller widens)", () => {
    expect(rankSimilar(target, [target])).toEqual([]);
    expect(rankSimilar(target, [sameArea])).toHaveLength(1);
  });

  it("amenity overlap + price closeness are bounded 0..1", () => {
    expect(amenityOverlap(["WiFi", "AC"], ["WiFi", "AC"])).toBe(1);
    expect(amenityOverlap(["WiFi"], ["Gym"])).toBe(0);
    expect(priceCloseness(800000, 800000)).toBe(1);
    expect(priceCloseness(null, 800000)).toBe(0);
  });
});

describe("filters — URL is the single source of truth (shareable/indexable)", () => {
  it("parses params, dropping invalid enums and splitting the amenities csv", () => {
    const f = parseFilters({
      city: "Bengaluru",
      gender: "FEMALE",
      badge: "NONSENSE",
      amenities: "WiFi, AC ,",
      sharingType: "2",
    });
    expect(f.city).toBe("Bengaluru");
    expect(f.gender).toBe("FEMALE");
    expect(f.badge).toBeUndefined(); // invalid badge dropped
    expect(f.amenities).toEqual(["WiFi", "AC"]);
  });

  it("round-trips state → URL → state", () => {
    const state: FilterState = {
      city: "Pune",
      gender: "MALE",
      minRentPaise: "500000",
      badge: "RA_VERIFIED",
      amenities: ["WiFi", "Food"],
    };
    const url = filtersToUrl(state);
    expect(url.startsWith("/search?")).toBe(true);
    const back = parseFilters(Object.fromEntries(filtersToSearchParams(state)));
    expect(back).toMatchObject(state);
  });

  it("maps to the backend query with amenities joined", () => {
    expect(filtersToQuery({ amenities: ["WiFi", "AC"], gender: "COED" })).toEqual({ amenities: "WiFi,AC", gender: "COED" });
    expect(isFilterEmpty(clearFilters())).toBe(true);
    expect(isFilterEmpty({ city: "X", amenities: [] })).toBe(false);
  });

  it("produces removable chips and removes exactly one (rent drops both bounds)", () => {
    const state: FilterState = {
      city: "Pune",
      minRentPaise: "500000",
      maxRentPaise: "900000",
      amenities: ["WiFi", "AC"],
      gender: "FEMALE",
    };
    const chips = activeChips(state);
    expect(chips.map((c) => c.key)).toContain("rent");
    expect(chips.find((c) => c.key === "amenity:WiFi")).toBeTruthy();

    const noRent = removeChip(state, "rent");
    expect(noRent.minRentPaise).toBeUndefined();
    expect(noRent.maxRentPaise).toBeUndefined();

    const noWifi = removeChip(state, "amenity:WiFi");
    expect(noWifi.amenities).toEqual(["AC"]);
  });

  it("summarises the match count", () => {
    expect(matchCountLabel(0, false)).toBe("No PGs match");
    expect(matchCountLabel(1, false)).toBe("1 PG");
    expect(matchCountLabel(24, true)).toBe("24+ PGs");
  });
});

describe("SEO search heading is unique per filter set", () => {
  it("varies with place, gender and refinements", () => {
    expect(searchHeading({ amenities: [] }).h1).toBe("PG accommodation across India");
    expect(searchHeading({ city: "Pune", amenities: [] }).h1).toBe("PG accommodation in Pune");
    expect(searchHeading({ city: "Pune", area: "Baner", gender: "FEMALE", amenities: [] }).h1).toBe(
      "Women's PG accommodation in Baner, Pune",
    );
    expect(searchHeading({ city: "Pune", amenities: [], badge: "RA_VERIFIED" }).description).toContain("Verified");
  });
});

describe("map projection + clustering (dependency-free, CSP-safe)", () => {
  it("has no bounds for an empty set", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("projects then unprojects back to the same point", () => {
    const pts = [
      { id: "a", lat: 12.90, lng: 77.60 },
      { id: "b", lat: 12.96, lng: 77.66 },
    ];
    const b = boundsOf(pts, 0)!;
    const p = project(pts[0]!, b, 400, 300);
    const round = unproject(p.x, p.y, b, 400, 300);
    expect(round.lat).toBeCloseTo(pts[0]!.lat, 5);
    expect(round.lng).toBeCloseTo(pts[0]!.lng, 5);
  });

  it("merges overlapping pins and separates distant ones", () => {
    const near = clusterPoints(
      [
        { id: "a", x: 60, y: 60 },
        { id: "b", x: 80, y: 80 },
        { id: "c", x: 400, y: 400 },
      ],
      52,
    );
    // a+b fall in the same 52px grid cell → one cluster of 2; c is its own.
    const sizes = near.map((c) => c.ids.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("derives a clamped search radius from a viewport", () => {
    const r = boundsRadiusMeters({ minLat: 12.9, maxLat: 12.96, minLng: 77.6, maxLng: 77.66 });
    expect(r).toBeGreaterThanOrEqual(500);
    expect(r).toBeLessThanOrEqual(10000);
  });
});
