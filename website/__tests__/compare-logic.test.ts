import { describe, expect, it } from "vitest";
import type { PublicListing, PublicRoom } from "@roomadda/shared";
import {
  buildCompareRows,
  canAddToCompare,
  canCompare,
  COMPARE_MAX,
  diffFlags,
  parseCompareIds,
  serializeCompareIds,
  toggleCompareId,
} from "../lib/compare";

function room(rent: number, name = "Standard", sharingType = 2): PublicRoom {
  return {
    id: `r-${name}-${rent}`,
    name,
    floor: 1,
    sharingType,
    monthlyRentPaise: rent,
    depositPaise: rent,
    tokenAmountPaise: rent,
    totalBeds: 4,
    availableBeds: 2,
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
    amenities: ["WiFi", "AC"],
    priceFromPaise: 800_000,
    instantBook: true,
    photos: [],
    rooms: [room(800_000)],
    ratingAverage: null,
    ratingCount: 0,
    badges: [],
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    masked: true,
    approxLocation: { lat: 12.9, lng: 77.6 },
    ...over,
  };
}

describe("compare set: holds 2–4, shareable, capped", () => {
  it("parses + caps a set at the max (4), de-duping and trimming", () => {
    expect(parseCompareIds("a,b,c,d,e")).toEqual(["a", "b", "c", "d"]);
    expect(parseCompareIds(" a , a , b ")).toEqual(["a", "b"]);
    expect(parseCompareIds("")).toEqual([]);
    expect(parseCompareIds(null)).toEqual([]);
  });

  it("round-trips through the URL string", () => {
    expect(serializeCompareIds(["a", "b"])).toBe("a,b");
    expect(parseCompareIds(serializeCompareIds(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });

  it("needs 2 to compare and stops adding past the cap", () => {
    expect(canCompare(["a"])).toBe(false);
    expect(canCompare(["a", "b"])).toBe(true);
    expect(canAddToCompare(["a", "b", "c"])).toBe(true);
    expect(canAddToCompare(["a", "b", "c", "d"])).toBe(false);
    expect(COMPARE_MAX).toBe(4);
  });

  it("toggles ids in/out and refuses to exceed the cap", () => {
    expect(toggleCompareId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleCompareId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleCompareId(["a", "b", "c", "d"], "e")).toEqual(["a", "b", "c", "d"]); // full
  });
});

describe("compare diff highlighting", () => {
  it("flags nothing when a row is uniform, everything when all distinct", () => {
    expect(diffFlags(["x", "x"])).toEqual([false, false]);
    expect(diffFlags(["x", "y"])).toEqual([true, true]);
    expect(diffFlags(["x", "x", "y"])).toEqual([false, false, true]); // odd one out
    expect(diffFlags(["only"])).toEqual([false]);
  });

  it("highlights the attribute rows that differ between the PGs", () => {
    const a = listing({ id: "a", gender: "MALE", rooms: [room(800_000)], amenities: ["WiFi"] });
    const b = listing({ id: "b", gender: "FEMALE", rooms: [room(1_200_000)], amenities: ["WiFi"] });
    const rows = buildCompareRows([a, b]);

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    // Gender + starting price differ; amenities are identical.
    expect(byKey.gender!.diff).toEqual([true, true]);
    expect(byKey.startingPrice!.diff).toEqual([true, true]);
    expect(byKey.amenities!.diff).toEqual([false, false]);
    // Displayed values are server-owned formatted strings, not recomputed.
    expect(byKey.startingPrice!.cells.map((c) => c.display)).toEqual(["₹8,000/mo", "₹12,000/mo"]);
  });

  it("holds 3–4 PGs with one cell per listing on every row", () => {
    const set = [listing({ id: "a" }), listing({ id: "b" }), listing({ id: "c" }), listing({ id: "d" })];
    const rows = buildCompareRows(set);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells).toHaveLength(4);
      expect(row.diff).toHaveLength(4);
    }
  });
});
