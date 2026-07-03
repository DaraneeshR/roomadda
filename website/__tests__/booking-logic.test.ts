import { describe, expect, it } from "vitest";
import type { BookingDetail, PrivateListing, PublicListing, PublicRoom } from "@roomadda/shared";
import {
  canPayWithKyc,
  classifyBooking,
  isRealCheckout,
  isRevealed,
  onlinePaymentBody,
  payNowPaise,
  revealedListing,
} from "../lib/booking";

// A room where the token, deposit, and rent are all DIFFERENT, so a test can
// prove the "pay now" figure is the token and not one of the others.
const room: PublicRoom = {
  id: "room-1",
  name: "Room 101",
  floor: 1,
  sharingType: 1,
  monthlyRentPaise: 1_200_000, // ₹12,000
  depositPaise: 1_000_000, // ₹10,000
  tokenAmountPaise: 200_000, // ₹2,000 — the server token
  totalBeds: 1,
  availableBeds: 1,
};

const commonListing = {
  id: "listing-1",
  alias: "Sunrise PG",
  areaLabel: "Koramangala",
  city: "Bengaluru",
  gender: "COED" as const,
  status: "PUBLISHED" as const,
  amenities: ["WIFI", "MEALS"],
  priceFromPaise: 1_200_000,
  instantBook: true,
  photos: [],
  rooms: [room],
  ratingAverage: null,
  ratingCount: 0,
  createdAt: "2026-06-01T00:00:00.000Z",
};

const maskedListing: PublicListing = {
  ...commonListing,
  masked: true,
  approxLocation: { lat: 12.93, lng: 77.62 },
};

const unmaskedListing: PrivateListing = {
  ...commonListing,
  masked: false,
  hostId: "host-1",
  actualName: "Sunrise Residency",
  fullAddress: "148, 5th Block, Koramangala, Bengaluru",
  pincode: "560095",
  location: { lat: 12.9352, lng: 77.6245 },
};

function bookingWith(overrides: Partial<BookingDetail>): BookingDetail {
  return {
    id: "booking-1",
    bedId: "bed-1",
    listingId: "listing-1",
    status: "TOKEN_PENDING",
    tokenAmountPaise: 200_000,
    monthlyRentPaise: 1_200_000,
    depositPaise: 1_000_000,
    moveInDate: "2026-08-01T00:00:00.000Z",
    holdExpiresAt: "2026-07-03T00:15:00.000Z",
    confirmedAt: null,
    createdAt: "2026-07-03T00:00:00.000Z",
    mealPlan: "Veg",
    hostName: null,
    listing: maskedListing,
    payment: null,
    ...overrides,
  };
}

describe("payNowPaise — the summary shows the SERVER token, not deposit/rent", () => {
  it("returns the room's server-owned tokenAmountPaise", () => {
    expect(payNowPaise(room)).toBe(200_000);
  });

  it("is NEVER the deposit or the monthly rent (no client-side token math)", () => {
    expect(payNowPaise(room)).not.toBe(room.depositPaise);
    expect(payNowPaise(room)).not.toBe(room.monthlyRentPaise);
  });

  it("ONLINE payment charges exactly the server token, in full, with no cash leg", () => {
    expect(onlinePaymentBody(payNowPaise(room))).toEqual({
      method: "ONLINE",
      onlinePaise: 200_000,
      cashPaise: 0,
    });
  });
});

describe("canPayWithKyc — payment blocked until KYC VERIFIED", () => {
  it("allows payment ONLY when VERIFIED", () => {
    expect(canPayWithKyc("VERIFIED")).toBe(true);
  });

  it("blocks every non-verified state", () => {
    expect(canPayWithKyc("NOT_SUBMITTED")).toBe(false);
    expect(canPayWithKyc("PENDING")).toBe(false);
    expect(canPayWithKyc("REJECTED")).toBe(false);
    expect(canPayWithKyc(null)).toBe(false);
    expect(canPayWithKyc(undefined)).toBe(false);
  });
});

describe("classifyBooking — CONFIRMED only via the server (webhook), never a callback", () => {
  it("keeps polling while the booking is still TOKEN_PENDING after the pay callback", () => {
    // Right after the Razorpay success callback, the SERVER still says
    // TOKEN_PENDING (the webhook hasn't landed). This must NOT be a confirm.
    const afterCallback = bookingWith({
      status: "TOKEN_PENDING",
      payment: { method: "RAZORPAY", status: "CREATED", online: { status: "CREATED", capturedAt: null }, cash: null },
    });
    expect(classifyBooking(afterCallback)).toBeNull();
  });

  it("confirms ONLY when the server reports status === CONFIRMED", () => {
    const confirmed = bookingWith({ status: "CONFIRMED", confirmedAt: "2026-07-03T00:05:00.000Z" });
    expect(classifyBooking(confirmed)).toEqual({ kind: "confirmed" });
  });

  it("reports expiry and payment failure as their own terminal states", () => {
    expect(classifyBooking(bookingWith({ status: "EXPIRED" }))).toEqual({ kind: "expired" });
    expect(classifyBooking(bookingWith({ status: "CANCELLED" }))).toEqual({ kind: "expired" });
    const failed = bookingWith({
      status: "TOKEN_PENDING",
      payment: { method: "RAZORPAY", status: "FAILED", online: { status: "FAILED", capturedAt: null }, cash: null },
    });
    expect(classifyBooking(failed)).toEqual({ kind: "paymentFailed" });
  });
});

describe("masking — masked pre-confirm, revealed after CONFIRMED", () => {
  it("hides the host + real identity while the hold is still pending", () => {
    const pending = bookingWith({ status: "TOKEN_PENDING", hostName: null, listing: maskedListing });
    expect(isRevealed(pending)).toBe(false);
    expect(revealedListing(pending)).toBeNull();
    expect(pending.listing.masked).toBe(true);
  });

  it("reveals the host name + unmasked listing once CONFIRMED", () => {
    const confirmed = bookingWith({
      status: "CONFIRMED",
      confirmedAt: "2026-07-03T00:05:00.000Z",
      hostName: "Harish Host",
      listing: unmaskedListing,
    });
    expect(isRevealed(confirmed)).toBe(true);
    const revealed = revealedListing(confirmed);
    expect(revealed?.actualName).toBe("Sunrise Residency");
    expect(revealed?.fullAddress).toContain("Koramangala");
    expect(confirmed.hostName).toBe("Harish Host");
  });
});

describe("isRealCheckout — real gateway vs the local stub", () => {
  it("uses real checkout for a real order from a real key", () => {
    expect(isRealCheckout({ orderId: "order_QabcXYZ", amount: 200_000, currency: "INR", keyId: "rzp_test_abc" })).toBe(true);
  });

  it("falls back (poll for demo:confirm) for a stubbed local order", () => {
    expect(isRealCheckout({ orderId: "order_stub_abc123", amount: 200_000, currency: "INR", keyId: "rzp_test_abc" })).toBe(false);
    expect(isRealCheckout(undefined)).toBe(false);
  });
});
