import { describe, expect, it } from "vitest";
import type { AreaInsights, PublicListing } from "@roomadda/shared";
import {
  areaSummary,
  formatBand,
  goodValueLabel,
  goodValueMap,
  histogramBars,
  isGoodValue,
  sharingLabel,
} from "../lib/areaInsights";

const insights: AreaInsights = {
  area: "Koramangala",
  city: "Bengaluru",
  listingCount: 3,
  roomCount: 5,
  overall: { minPaise: 700_000, typicalPaise: 1_000_000, maxPaise: 1_500_000, avgPaise: 1_050_000, roomCount: 5 },
  byGender: [{ gender: "FEMALE", band: { minPaise: 700_000, typicalPaise: 900_000, maxPaise: 1_100_000, avgPaise: 900_000, roomCount: 2 } }],
  byRoomType: [
    { sharingType: 1, band: { minPaise: 1_400_000, typicalPaise: 1_500_000, maxPaise: 1_500_000, avgPaise: 1_450_000, roomCount: 1 } },
    { sharingType: 3, band: { minPaise: 700_000, typicalPaise: 750_000, maxPaise: 800_000, avgPaise: 750_000, roomCount: 2 } },
  ],
  histogram: [
    { fromPaise: 700_000, toPaise: 1_100_000, count: 3 },
    { fromPaise: 1_100_000, toPaise: 1_500_000, count: 2 },
  ],
  generatedAt: "2026-07-04T00:00:00.000Z",
};

function listing(id: string, from: number): PublicListing {
  return {
    id,
    alias: id,
    areaLabel: "Koramangala",
    city: "Bengaluru",
    gender: "COED",
    status: "PUBLISHED",
    amenities: [],
    priceFromPaise: from,
    instantBook: true,
    photos: [],
    rooms: [{ id: `${id}-r`, name: "R", floor: 1, sharingType: 2, monthlyRentPaise: from, depositPaise: 0, tokenAmountPaise: from, totalBeds: 2, availableBeds: 1 }],
    ratingAverage: null,
    ratingCount: 0,
    badges: [],
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    masked: true,
    approxLocation: { lat: 12.9, lng: 77.6 },
  };
}

describe("area insights display", () => {
  it("flags a listing below the area's typical rent as good value, not one above", () => {
    expect(isGoodValue(800_000, insights)).toBe(true); // below ₹10k typical
    expect(isGoodValue(1_000_000, insights)).toBe(false); // at typical
    expect(isGoodValue(1_200_000, insights)).toBe(false); // above typical
    expect(isGoodValue(null, insights)).toBe(false);
    expect(isGoodValue(800_000, null)).toBe(false); // no bands → never claim value
  });

  it("labels how far below typical a good-value listing sits", () => {
    expect(goodValueLabel(800_000, insights)).toBe("20% below the Koramangala typical rent");
    expect(goodValueLabel(1_000_000, insights)).toBeNull();
  });

  it("builds a good-value map only for the cheaper listings", () => {
    const map = goodValueMap([listing("cheap", 750_000), listing("dear", 1_300_000)], insights);
    expect(Object.keys(map)).toEqual(["cheap"]);
    expect(map.cheap).toMatch(/below/);
  });

  it("formats bands + sharing labels and summarises the area in plain English", () => {
    expect(formatBand(insights.overall!)).toBe("₹7,000 – ₹15,000 (typ. ₹10,000)");
    expect(sharingLabel(1)).toBe("Private room");
    expect(sharingLabel(3)).toBe("3-sharing");
    const summary = areaSummary(insights);
    expect(summary).toContain("Koramangala");
    expect(summary).toContain("₹10,000");
  });

  it("scales histogram bars to the tallest column", () => {
    const bars = histogramBars(insights.histogram);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.heightPct).toBe(100); // tallest (count 3)
    expect(bars[1]!.heightPct).toBe(67); // 2/3 rounded
  });
});
