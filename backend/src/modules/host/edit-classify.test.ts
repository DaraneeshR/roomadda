import { describe, expect, it } from "vitest";
import { classifyListingEdit, classifyRoomEdit, isRentChangeSignificant } from "./edit-classify.js";

describe("host edit classification", () => {
  const before = {
    alias: "Sunrise PG",
    fullAddress: "12 MG Road",
    pincode: "560001",
    latitude: 12.97,
    longitude: 77.59,
    amenities: ["wifi", "ac"],
    houseRules: ["No smoking"],
  };

  it("treats a name/amenity edit as MINOR (live immediately)", () => {
    const result = classifyListingEdit(before, { alias: "Sunset PG", amenities: ["wifi", "ac", "gym"] });
    expect(result.requeue).toBe(false);
    expect(result.changedFields.sort()).toEqual(["alias", "amenities"]);
  });

  it("RE-QUEUES when the address (or any geo field) changes", () => {
    expect(classifyListingEdit(before, { fullAddress: "9 Brigade Rd" }).requeue).toBe(true);
    expect(classifyListingEdit(before, { pincode: "560002" }).requeue).toBe(true);
    expect(classifyListingEdit(before, { latitude: 13.0 }).requeue).toBe(true);
  });

  it("ignores no-op patches (same value is not a change)", () => {
    const result = classifyListingEdit(before, { alias: "Sunrise PG", fullAddress: "12 MG Road" });
    expect(result.changedFields).toEqual([]);
    expect(result.requeue).toBe(false);
  });

  it("compares array fields by value, not reference", () => {
    expect(classifyListingEdit(before, { houseRules: ["No smoking"] }).changedFields).toEqual([]);
    expect(classifyListingEdit(before, { houseRules: ["No smoking", "No pets"] }).changedFields).toEqual([
      "houseRules",
    ]);
  });

  describe("rent threshold (>20% re-queues)", () => {
    it("re-queues a rent rise of more than 20%", () => {
      expect(isRentChangeSignificant(1_000_000, 1_300_000)).toBe(true); // +30%
    });
    it("allows a rent change of 20% or less", () => {
      expect(isRentChangeSignificant(1_000_000, 1_200_000)).toBe(false); // exactly +20%
      expect(isRentChangeSignificant(1_000_000, 900_000)).toBe(false); // -10%
    });
    it("treats pricing a previously-zero room as significant", () => {
      expect(isRentChangeSignificant(0, 800_000)).toBe(true);
    });
  });

  it("classifyRoomEdit re-queues only on a >20% rent move", () => {
    const room = { name: "Room A", floor: 1, sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 };
    expect(classifyRoomEdit(room, { name: "Room B" }).requeue).toBe(false);
    expect(classifyRoomEdit(room, { monthlyRentPaise: 1_150_000 }).requeue).toBe(false); // +15%
    const big = classifyRoomEdit(room, { monthlyRentPaise: 1_500_000 });
    expect(big.requeue).toBe(true);
    expect(big.changedFields).toEqual(["monthlyRentPaise"]);
  });
});
