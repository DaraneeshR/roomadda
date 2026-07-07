import { describe, it, expect } from "vitest";
import { bookingDetailSchema } from "@roomadda/shared";
import { toBookingDetail, type BookingWithRelations } from "./booking.serializer.js";

const NOW = new Date("2026-06-21T00:00:00.000Z");
const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const BOOKING_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const BED_ID = "cccccccc-3333-4333-8333-333333333333";

/** Fields the masked (public) listing shape must NEVER expose. */
const LEAKY_KEYS = ["actualName", "fullAddress", "pincode", "location", "hostId"];

function makeListing(): BookingWithRelations["listing"] {
  return {
    id: LISTING_ID,
    hostId: HOST_ID,
    alias: "Sunrise PG",
    areaLabel: "Koramangala",
    city: "Bengaluru",
    amenities: ["wifi"],
    actualName: "Sunrise Premium PG (Mr. Rao)",
    fullAddress: "123 Exact Street, 5th Block",
    pincode: "560034",
    latitude: 12.9352,
    longitude: 77.6245,
    status: "PUBLISHED",
    propertyType: "PG",
    visibility: "USER_ONLY",
    gender: "COED",
    instantBook: true,
    mealsOffered: false,
    mealChargesPaise: null,
    houseRules: [],
    tokenAmountPaise: null,
    paused: false,
    ratingSum: 0,
    ratingCount: 0,
    recentBookingCount: 0,
    recentBookingWindowDays: null,
    recentBookingCountAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    photos: [],
    rooms: [],
    trustTags: [],
    host: { id: HOST_ID, fullName: "Mr. Rao" },
  };
}

function makeBooking(overrides: Partial<BookingWithRelations> = {}): BookingWithRelations {
  return {
    id: BOOKING_ID,
    bedId: BED_ID,
    tenantId: TENANT_ID,
    listingId: LISTING_ID,
    status: "TOKEN_PENDING",
    tokenAmountPaise: 500_000,
    monthlyRentPaise: 1_000_000,
    depositPaise: 500_000,
    moveInDate: null,
    mealPlan: null,
    bookedByAgentId: null,
    agentChannel: null,
    confirmedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    refundPaise: null,
    refundReason: null,
    holdExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    paymentProofKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    payment: null,
    cashCollections: [],
    listing: makeListing(),
    ...overrides,
  };
}

function capturedOnlinePayment(): NonNullable<BookingWithRelations["payment"]> {
  return {
    id: "dddddddd-4444-4444-8444-444444444444",
    bookingId: BOOKING_ID,
    amountPaise: 500_000,
    currency: "INR",
    status: "CAPTURED",
    method: "RAZORPAY",
    razorpayOrderId: "order_test",
    createdAt: NOW,
    updatedAt: NOW,
    transactions: [
      {
        id: "eeeeeeee-5555-4555-8555-555555555555",
        paymentId: "dddddddd-4444-4444-8444-444444444444",
        razorpayPaymentId: "pay_test",
        amountPaise: 500_000,
        status: "CAPTURED",
        method: "RAZORPAY",
        capturedAt: new Date("2026-06-21T00:05:00.000Z"),
        webhookEventId: "ffffffff-6666-4666-8666-666666666666",
        createdAt: NOW,
      },
    ],
  };
}

describe("toBookingDetail — output always satisfies the shared contract", () => {
  it("a TOKEN_PENDING booking parses against bookingDetailSchema", () => {
    expect(() => bookingDetailSchema.parse(toBookingDetail(makeBooking()))).not.toThrow();
  });
  it("a CONFIRMED booking parses against bookingDetailSchema", () => {
    const detail = toBookingDetail(makeBooking({ status: "CONFIRMED", confirmedAt: NOW, payment: capturedOnlinePayment() }));
    expect(() => bookingDetailSchema.parse(detail)).not.toThrow();
  });
});

describe("toBookingDetail — listing masking follows booking status", () => {
  it("TOKEN_PENDING -> masked public listing, no private fields", () => {
    const detail = toBookingDetail(makeBooking({ status: "TOKEN_PENDING" }));
    expect(detail.listing.masked).toBe(true);
    const listing = detail.listing as unknown as Record<string, unknown>;
    for (const key of LEAKY_KEYS) {
      expect(listing).not.toHaveProperty(key);
    }
    // confirmedAt is null while still on hold.
    expect(detail.confirmedAt).toBeNull();
  });

  it("non-confirmed terminal states (EXPIRED/CANCELLED) also stay masked", () => {
    for (const status of ["EXPIRED", "CANCELLED"] as const) {
      const detail = toBookingDetail(makeBooking({ status }));
      expect(detail.listing.masked).toBe(true);
    }
  });

  it("CONFIRMED -> unmasked private listing for the tenant", () => {
    const detail = toBookingDetail(makeBooking({ status: "CONFIRMED", confirmedAt: NOW }));
    expect(detail.listing.masked).toBe(false);
    if (detail.listing.masked === false) {
      expect(detail.listing.actualName).toContain("Sunrise Premium");
      expect(detail.listing.fullAddress).toContain("Exact Street");
      expect(detail.listing.location).toEqual({ lat: 12.9352, lng: 77.6245 });
    }
  });
});

describe("toBookingDetail — payment summary the screen polls", () => {
  it("no payment yet -> payment is null", () => {
    expect(toBookingDetail(makeBooking({ payment: null })).payment).toBeNull();
  });

  it("CONFIRMED exposes confirmedAt and payment.online.capturedAt", () => {
    const detail = toBookingDetail(
      makeBooking({ status: "CONFIRMED", confirmedAt: NOW, payment: capturedOnlinePayment() }),
    );
    expect(detail.confirmedAt).toBe(NOW.toISOString());
    expect(detail.payment).not.toBeNull();
    expect(detail.payment?.status).toBe("CAPTURED");
    expect(detail.payment?.online?.status).toBe("CAPTURED");
    expect(detail.payment?.online?.capturedAt).toBe("2026-06-21T00:05:00.000Z");
    // No cash leg on a pure-online payment.
    expect(detail.payment?.cash).toBeNull();
  });

  it("TOKEN_PENDING online leg is present but not yet captured", () => {
    const pending = capturedOnlinePayment();
    pending.status = "CREATED";
    pending.transactions[0]!.status = "CREATED";
    pending.transactions[0]!.capturedAt = null;
    const detail = toBookingDetail(makeBooking({ status: "TOKEN_PENDING", payment: pending }));
    expect(detail.payment?.online?.status).toBe("CREATED");
    expect(detail.payment?.online?.capturedAt).toBeNull();
  });

  it("a split payment reports both the online and cash legs", () => {
    const payment = capturedOnlinePayment();
    payment.method = "SPLIT";
    const detail = toBookingDetail(
      makeBooking({
        status: "TOKEN_PENDING",
        payment,
        cashCollections: [
          {
            id: "11111111-7777-4777-8777-777777777777",
            bookingId: BOOKING_ID,
            agentId: "22222222-8888-4888-8888-888888888888",
            amountPaise: 250_000,
            status: "PENDING",
            collectedAt: null,
            reconciledAt: null,
            note: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      }),
    );
    expect(detail.payment?.method).toBe("SPLIT");
    expect(detail.payment?.online?.status).toBe("CAPTURED");
    expect(detail.payment?.cash?.status).toBe("PENDING");
  });
});
