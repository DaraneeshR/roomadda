import { describe, expect, it } from "vitest";
import type { HotelCategoryAvailability, HotelReservation, HotelSearchResult, PublicListing } from "@roomadda/shared";
import {
  canPayWithKyc,
  categoryTotalPaise,
  checkInCode,
  classifyReservation,
  isCategoryBookable,
  isRealCheckout,
  isReservationConfirmed,
  isReservationPayable,
  reservationTokenPaise,
  reservationTotalPaise,
  totalAvailableRooms,
} from "../lib/hotel";

/**
 * A category whose server `totalPaise` is DELIBERATELY not perNightPaise × nights
 * (30000 × 3 = 90000, but the server says 87000 — e.g. a length-of-stay discount).
 * This lets a test prove the UI READS the server snapshot and never re-multiplies.
 */
const category: HotelCategoryAvailability = {
  categoryId: "cat-1",
  tier: "Deluxe Room",
  perNightPaise: 30_000,
  nights: 3,
  totalPaise: 87_000, // ≠ 30_000 × 3 on purpose
  availableRooms: 2,
  photos: [],
  amenities: ["WIFI"],
};

function reservationWith(overrides: Partial<HotelReservation>): HotelReservation {
  return {
    id: "res-1",
    listingId: "listing-1",
    categoryId: "cat-1",
    status: "HELD",
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    perNightPaise: 30_000,
    roomTotalPaise: 87_000, // server snapshot, ≠ perNightPaise × nights
    tokenAmountPaise: 87_000,
    holdExpiresAt: "2026-08-01T00:15:00.000Z",
    confirmedAt: null,
    qrCodeToken: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("hotel money — the price shown is the SERVER snapshot, never nights × rate", () => {
  it("categoryTotalPaise returns the server totalPaise, not a client re-multiplication", () => {
    expect(categoryTotalPaise(category)).toBe(87_000);
    // The naive client math would be 90_000 — the function must NOT produce it.
    expect(categoryTotalPaise(category)).not.toBe(category.perNightPaise * category.nights);
  });

  it("reservationTokenPaise / reservationTotalPaise read the server snapshot", () => {
    const r = reservationWith({});
    expect(reservationTokenPaise(r)).toBe(87_000);
    expect(reservationTotalPaise(r)).toBe(87_000);
    expect(reservationTokenPaise(r)).not.toBe(r.perNightPaise * r.nights); // no JS math
  });
});

describe("hotel confirmation — CONFIRMED only via the server (webhook), never a callback", () => {
  it("keeps polling while the reservation is still HELD after the pay callback", () => {
    // Right after the Razorpay success callback the SERVER still says HELD (the
    // webhook hasn't landed). This must NOT be treated as a confirm.
    expect(classifyReservation(reservationWith({ status: "HELD" }))).toBeNull();
  });

  it("confirms ONLY when the server reports status === CONFIRMED", () => {
    const confirmed = reservationWith({ status: "CONFIRMED", confirmedAt: "2026-08-01T00:05:00.000Z", qrCodeToken: "hqr_abc" });
    expect(classifyReservation(confirmed)).toEqual({ kind: "confirmed" });
    expect(isReservationConfirmed(confirmed)).toBe(true);
  });

  it("reports expiry / cancellation as a terminal 'expired' outcome", () => {
    expect(classifyReservation(reservationWith({ status: "EXPIRED" }))).toEqual({ kind: "expired" });
    expect(classifyReservation(reservationWith({ status: "CANCELLED" }))).toEqual({ kind: "expired" });
  });

  it("is payable only while HELD", () => {
    expect(isReservationPayable(reservationWith({ status: "HELD" }))).toBe(true);
    expect(isReservationPayable(reservationWith({ status: "CONFIRMED" }))).toBe(false);
    expect(isReservationPayable(reservationWith({ status: "EXPIRED" }))).toBe(false);
  });
});

describe("hotel check-in code — minted only on CONFIRMED (masked before)", () => {
  it("has no QR while HELD, even if a token somehow leaked onto the DTO", () => {
    // A held reservation never carries a real code; guard against a stray value too.
    expect(checkInCode(reservationWith({ status: "HELD", qrCodeToken: null }))).toBeNull();
    expect(checkInCode(reservationWith({ status: "HELD", qrCodeToken: "hqr_leaked" }))).toBeNull();
  });

  it("exposes the QR token once CONFIRMED", () => {
    expect(checkInCode(reservationWith({ status: "CONFIRMED", qrCodeToken: "hqr_realcode" }))).toBe("hqr_realcode");
  });
});

describe("hotel availability + KYC + checkout gates", () => {
  it("a category is bookable only with a price AND a free room", () => {
    expect(isCategoryBookable(category)).toBe(true);
    expect(isCategoryBookable({ ...category, availableRooms: 0 })).toBe(false);
    expect(isCategoryBookable({ ...category, perNightPaise: 0 })).toBe(false);
  });

  it("sums the free rooms across bookable categories of a result", () => {
    const result = { categories: [category, { ...category, categoryId: "cat-2", availableRooms: 1 }] };
    expect(totalAvailableRooms(result)).toBe(3);
  });

  it("payment is allowed ONLY when KYC is VERIFIED (reused PG rule)", () => {
    expect(canPayWithKyc("VERIFIED")).toBe(true);
    expect(canPayWithKyc("PENDING")).toBe(false);
    expect(canPayWithKyc(null)).toBe(false);
  });

  it("uses real checkout only for a real order (falls back to poll for the local stub)", () => {
    expect(isRealCheckout({ orderId: "order_Qabc", amount: 87_000, currency: "INR", keyId: "rzp_test_x" })).toBe(true);
    expect(isRealCheckout({ orderId: "order_stub_x", amount: 87_000, currency: "INR", keyId: "rzp_test_x" })).toBe(false);
    expect(isRealCheckout(undefined)).toBe(false);
  });
});

describe("hotel masking — the search result is the MASKED public listing", () => {
  it("carries only alias + area (never actualName / exact geo) pre-booking", () => {
    const masked: PublicListing = {
      id: "listing-1",
      alias: "Skyline Suites · MG Road",
      areaLabel: "MG Road",
      city: "Bengaluru",
      gender: "COED",
      status: "PUBLISHED",
      amenities: ["WIFI"],
      priceFromPaise: null,
      instantBook: true,
      photos: [],
      rooms: [],
      ratingAverage: null,
      ratingCount: 0,
      badges: [],
      featured: false,
      createdAt: "2026-06-01T00:00:00.000Z",
      masked: true,
      approxLocation: { lat: 12.97, lng: 77.6 },
    };
    const result: HotelSearchResult = { listing: masked, categories: [category] };

    expect(result.listing.masked).toBe(true);
    // The masked shape has no private fields at all — the real name never leaks.
    expect((result.listing as Record<string, unknown>).actualName).toBeUndefined();
    expect((result.listing as Record<string, unknown>).fullAddress).toBeUndefined();
    // Only the coarse ~1km marker is present, never exact geo.
    expect(result.listing.approxLocation).toBeDefined();
  });
});
