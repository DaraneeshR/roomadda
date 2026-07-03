import { describe, expect, it } from "vitest";
import type { HostListing } from "@roomadda/shared";
import {
  canSubmitForReview,
  hasPricedRoom,
  hostAccess,
  isRentChangeSignificant,
  listingEditWillRequeue,
  listingOccupancy,
  listingState,
  MIN_PUBLISH_PHOTOS,
  missingSubmitGates,
  photosStillNeeded,
} from "../lib/host";

/** A minimal room-inventory row for occupancy/priced-room checks. */
function room(partial: Partial<HostListing["rooms"][number]> = {}): HostListing["rooms"][number] {
  return {
    roomId: "r1",
    name: "Room 1",
    floor: null,
    sharingType: 2,
    monthlyRentPaise: 1_200_000,
    depositPaise: 0,
    totalBeds: 2,
    bookedBeds: 0,
    walkInBeds: 0,
    heldBeds: 0,
    availableBeds: 2,
    needsVerification: false,
    inventoryVerifiedAt: null,
    ...partial,
  };
}

describe("host-only access gate (non-host is redirected away)", () => {
  it("allows only a HOST; a non-host is forbidden (→ redirect)", () => {
    expect(hostAccess("authenticated", "HOST")).toBe("allowed");
    expect(hostAccess("authenticated", "TENANT")).toBe("forbidden");
    expect(hostAccess("authenticated", "AGENT")).toBe("forbidden");
    expect(hostAccess("authenticated", "ADMIN")).toBe("forbidden");
    expect(hostAccess("authenticated", null)).toBe("forbidden");
  });

  it("defers while loading and prompts login when anonymous", () => {
    expect(hostAccess("loading", undefined)).toBe("loading");
    expect(hostAccess("anonymous", undefined)).toBe("anonymous");
  });
});

describe("submit-for-review gate (mirrors §9.2, client-visible conditions)", () => {
  it("requires at least 5 photos AND a priced room", () => {
    expect(canSubmitForReview({ photoCount: 5, hasPricedRoom: true })).toBe(true);
    expect(missingSubmitGates({ photoCount: 5, hasPricedRoom: true })).toEqual([]);
  });

  it("flags too-few photos", () => {
    expect(canSubmitForReview({ photoCount: 4, hasPricedRoom: true })).toBe(false);
    expect(missingSubmitGates({ photoCount: 4, hasPricedRoom: true })).toEqual(["photos"]);
    expect(photosStillNeeded(4)).toBe(1);
    expect(photosStillNeeded(5)).toBe(0);
    expect(MIN_PUBLISH_PHOTOS).toBe(5);
  });

  it("flags no priced room", () => {
    expect(missingSubmitGates({ photoCount: 5, hasPricedRoom: false })).toEqual(["rooms"]);
    expect(missingSubmitGates({ photoCount: 0, hasPricedRoom: false })).toEqual(["photos", "rooms"]);
  });

  it("reads a priced room off the listing rooms", () => {
    expect(hasPricedRoom({ rooms: [room({ monthlyRentPaise: 0 })] })).toBe(false);
    expect(hasPricedRoom({ rooms: [room({ monthlyRentPaise: 0 }), room({ monthlyRentPaise: 500 })] })).toBe(true);
  });
});

describe("edit re-queue prediction (mirrors the backend classifier)", () => {
  it("re-queues when an address field actually changes", () => {
    const before = { fullAddress: "12 MG Rd", pincode: "560001", latitude: 12.9, longitude: 77.6 };
    expect(listingEditWillRequeue(before, { fullAddress: "99 MG Rd" })).toBe(true);
    expect(listingEditWillRequeue(before, { pincode: "560002" })).toBe(true);
    expect(listingEditWillRequeue(before, { latitude: 12.95 })).toBe(true);
  });

  it("does NOT re-queue when the address is unchanged or a non-address field changes", () => {
    const before = { fullAddress: "12 MG Rd", pincode: "560001", latitude: 12.9, longitude: 77.6 };
    expect(listingEditWillRequeue(before, { fullAddress: "12 MG Rd" })).toBe(false);
    expect(listingEditWillRequeue(before, {})).toBe(false);
  });

  it("treats a rent change over 20% (or off zero) as significant", () => {
    expect(isRentChangeSignificant(1000, 1200)).toBe(false); // exactly 20% is not "more than"
    expect(isRentChangeSignificant(1000, 1201)).toBe(true);
    expect(isRentChangeSignificant(1000, 700)).toBe(true); // -30%
    expect(isRentChangeSignificant(0, 1)).toBe(true); // unpriced -> priced
    expect(isRentChangeSignificant(0, 0)).toBe(false);
  });
});

describe("lifecycle state + occupancy", () => {
  it("folds status + pause into one state", () => {
    expect(listingState({ status: "PUBLISHED", paused: false })).toBe("LIVE");
    expect(listingState({ status: "PUBLISHED", paused: true })).toBe("PAUSED");
    expect(listingState({ status: "DRAFT", paused: false })).toBe("DRAFT");
    expect(listingState({ status: "PENDING_REVIEW", paused: false })).toBe("IN_REVIEW");
    expect(listingState({ status: "SUSPENDED", paused: false })).toBe("SUSPENDED");
  });

  it("sums bed occupancy across rooms (booked + walk-in + held = occupied)", () => {
    const occ = listingOccupancy({
      rooms: [
        room({ totalBeds: 4, availableBeds: 1 }),
        room({ totalBeds: 2, availableBeds: 2 }),
      ],
    });
    expect(occ.totalBeds).toBe(6);
    expect(occ.availableBeds).toBe(3);
    expect(occ.occupiedBeds).toBe(3);
    expect(occ.percent).toBe(50);
  });

  it("reports 0% occupancy with no beds (no divide-by-zero)", () => {
    expect(listingOccupancy({ rooms: [] }).percent).toBe(0);
  });
});
