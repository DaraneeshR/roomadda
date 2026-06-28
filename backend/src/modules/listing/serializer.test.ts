import { describe, it, expect } from "vitest";
import {
  canManageListing,
  canViewPrivateListing,
  toPrivateListing,
  toPublicListing,
  type ListingWithRelations,
} from "./serializer.js";

const EXACT_LAT = 12.9352;
const EXACT_LNG = 77.6245;

function makeListing(overrides: Partial<ListingWithRelations> = {}): ListingWithRelations {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const listingId = "11111111-1111-4111-8111-111111111111";
  return {
    id: listingId,
    hostId: "22222222-2222-4222-8222-222222222222",
    alias: "Sunrise PG",
    areaLabel: "Koramangala",
    city: "Bengaluru",
    amenities: ["wifi", "food"],
    actualName: "Sunrise Premium PG (Mr. Rao)",
    fullAddress: "123 Exact Street, 5th Block",
    pincode: "560034",
    latitude: EXACT_LAT,
    longitude: EXACT_LNG,
    status: "PUBLISHED",
    gender: "COED",
    instantBook: true,
    createdAt: now,
    updatedAt: now,
    photos: [],
    rooms: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        listingId,
        name: "Room A",
        floor: 1,
        sharingType: 2,
        monthlyRentPaise: 1_200_000,
        depositPaise: 2_400_000,
        createdAt: now,
        updatedAt: now,
        beds: [
          { id: "b1", status: "AVAILABLE" },
          { id: "b2", status: "BOOKED" },
        ],
      },
    ],
    ...overrides,
  };
}

const LEAKY_KEYS = ["actualName", "fullAddress", "pincode", "latitude", "longitude", "location", "hostId"];

describe("toPublicListing (masking)", () => {
  it("never leaks exact identity, address, pincode, or geo", () => {
    const pub = toPublicListing(makeListing()) as unknown as Record<string, unknown>;
    for (const key of LEAKY_KEYS) {
      expect(pub).not.toHaveProperty(key);
    }
    expect(pub.masked).toBe(true);
  });

  it("exposes only a coarse approximate marker, not the exact point", () => {
    const pub = toPublicListing(makeListing());
    expect(pub.approxLocation.lat).not.toBe(EXACT_LAT);
    expect(pub.approxLocation.lng).not.toBe(EXACT_LNG);
    // within ~1.1km (2dp rounding)
    expect(Math.abs(pub.approxLocation.lat - EXACT_LAT)).toBeLessThan(0.01);
  });

  it("keeps public-safe fields and bed availability", () => {
    const pub = toPublicListing(makeListing());
    expect(pub).toMatchObject({ alias: "Sunrise PG", city: "Bengaluru", areaLabel: "Koramangala" });
    expect(pub.priceFromPaise).toBe(1_200_000);
    expect(pub.rooms[0]?.totalBeds).toBe(2);
    expect(pub.rooms[0]?.availableBeds).toBe(1);
  });
});

describe("toPrivateListing", () => {
  it("includes the unmasked fields", () => {
    const priv = toPrivateListing(makeListing());
    expect(priv.actualName).toContain("Sunrise Premium");
    expect(priv.fullAddress).toContain("Exact Street");
    expect(priv.pincode).toBe("560034");
    expect(priv.location).toEqual({ lat: EXACT_LAT, lng: EXACT_LNG });
    expect(priv.masked).toBe(false);
  });
});

describe("canViewPrivateListing (who may unmask)", () => {
  const listing = { hostId: "host-1" };

  it("anonymous caller -> masked", () => {
    expect(canViewPrivateListing(listing, { user: null, hasConfirmedBooking: false })).toBe(false);
  });
  it("owning host -> private", () => {
    expect(canViewPrivateListing(listing, { user: { id: "host-1", role: "HOST" }, hasConfirmedBooking: false })).toBe(true);
  });
  it("a different host -> masked", () => {
    expect(canViewPrivateListing(listing, { user: { id: "host-2", role: "HOST" }, hasConfirmedBooking: false })).toBe(false);
  });
  it("admin and agent -> private", () => {
    expect(canViewPrivateListing(listing, { user: { id: "a", role: "ADMIN" }, hasConfirmedBooking: false })).toBe(true);
    expect(canViewPrivateListing(listing, { user: { id: "a", role: "AGENT" }, hasConfirmedBooking: false })).toBe(true);
  });
  it("tenant WITHOUT a confirmed booking -> masked", () => {
    expect(canViewPrivateListing(listing, { user: { id: "t", role: "TENANT" }, hasConfirmedBooking: false })).toBe(false);
  });
  it("tenant WITH a confirmed booking -> private", () => {
    expect(canViewPrivateListing(listing, { user: { id: "t", role: "TENANT" }, hasConfirmedBooking: true })).toBe(true);
  });
});

describe("canManageListing (default-deny ownership)", () => {
  const listing = { hostId: "host-1" };
  it("owning host -> allowed", () => {
    expect(canManageListing(listing, { id: "host-1", role: "HOST" })).toBe(true);
  });
  it("non-owning host -> denied", () => {
    expect(canManageListing(listing, { id: "host-2", role: "HOST" })).toBe(false);
  });
  it("admin -> allowed; tenant -> denied", () => {
    expect(canManageListing(listing, { id: "x", role: "ADMIN" })).toBe(true);
    expect(canManageListing(listing, { id: "t", role: "TENANT" })).toBe(false);
  });
});
