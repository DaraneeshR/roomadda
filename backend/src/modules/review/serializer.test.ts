import { describe, it, expect } from "vitest";
import type { BookingStatus } from "@prisma/client";
import {
  canReviewFromBooking,
  isReviewableStatus,
  toReview,
  type ReviewWithRelations,
} from "./serializer.js";

const ALL_STATUSES: BookingStatus[] = [
  "INITIATED",
  "PENDING_APPROVAL",
  "TOKEN_PENDING",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
];

describe("isReviewableStatus (eligible stays only)", () => {
  it("allows only CONFIRMED and COMPLETED", () => {
    const allowed = ALL_STATUSES.filter(isReviewableStatus);
    expect(allowed.sort()).toEqual(["COMPLETED", "CONFIRMED"]);
  });
});

describe("canReviewFromBooking (default-deny predicate)", () => {
  const ctx = { tenantId: "tenant-1", listingId: "listing-1" };
  const eligible = { tenantId: "tenant-1", listingId: "listing-1", status: "CONFIRMED" as BookingStatus };

  it("allows the owning tenant's confirmed stay on this listing", () => {
    expect(canReviewFromBooking(eligible, ctx)).toBe(true);
    expect(canReviewFromBooking({ ...eligible, status: "COMPLETED" }, ctx)).toBe(true);
  });

  it("rejects a stay that is not confirmed/completed", () => {
    expect(canReviewFromBooking({ ...eligible, status: "TOKEN_PENDING" }, ctx)).toBe(false);
    expect(canReviewFromBooking({ ...eligible, status: "CANCELLED" }, ctx)).toBe(false);
  });

  it("rejects another tenant's booking", () => {
    expect(canReviewFromBooking({ ...eligible, tenantId: "tenant-2" }, ctx)).toBe(false);
  });

  it("rejects a booking on a different listing", () => {
    expect(canReviewFromBooking({ ...eligible, listingId: "listing-2" }, ctx)).toBe(false);
  });
});

describe("toReview", () => {
  const base: ReviewWithRelations = {
    id: "r1",
    bookingId: "b1",
    listingId: "listing-1",
    tenantId: "tenant-1",
    rating: 5,
    text: "Clean and safe.",
    hostResponse: null,
    hostRespondedAt: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    tenant: { fullName: "Priya K" },
  };

  it("exposes the attributed author name and no other tenant PII", () => {
    const dto = toReview(base) as unknown as Record<string, unknown>;
    expect(dto.authorName).toBe("Priya K");
    expect(dto.rating).toBe(5);
    expect(dto.text).toBe("Clean and safe.");
    // The internal booking/tenant ids never surface on the public DTO.
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("bookingId");
    expect(dto).not.toHaveProperty("tenant");
  });

  it("serializes a pending host response as nulls, and a set one with a timestamp", () => {
    expect(toReview(base).hostResponse).toBeNull();
    expect(toReview(base).respondedAt).toBeNull();

    const replied = toReview({
      ...base,
      hostResponse: "Thank you!",
      hostRespondedAt: new Date("2026-02-02T00:00:00.000Z"),
    });
    expect(replied.hostResponse).toBe("Thank you!");
    expect(replied.respondedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("carries a star-only review (null text) through", () => {
    expect(toReview({ ...base, text: null }).text).toBeNull();
  });
});
