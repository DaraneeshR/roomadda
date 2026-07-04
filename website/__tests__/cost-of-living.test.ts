import { describe, expect, it } from "vitest";
import { amenitiesIncludeMeals, estimateCostOfLiving, type CostInput } from "../lib/costOfLiving";

/** Every case a panel can render — the label must survive all of them. */
const CASES: CostInput[] = [
  { rentFromPaise: 800_000, rentToPaise: 1_200_000, mealsIncluded: false, city: "Bengaluru" },
  { rentFromPaise: 800_000, mealsIncluded: true, city: "Mumbai" },
  { rentFromPaise: null, mealsIncluded: false }, // unpriced area
  { rentFromPaise: 600_000, mealsIncluded: false, city: "Nowhereville" }, // falls back to defaults
];

describe("cost of living: ALWAYS an estimate", () => {
  it("labels every result an estimate (flag + disclaimer), never exact", () => {
    for (const input of CASES) {
      const est = estimateCostOfLiving(input);
      expect(est.isEstimate).toBe(true);
      expect(est.disclaimer.toLowerCase().startsWith("estimate")).toBe(true);
      expect(/estimate/i.test(est.disclaimer)).toBe(true);
      expect(est.totalLabel).toContain("month");
    }
  });

  it("gives a breakdown + a total RANGE from live rent plus baselines", () => {
    const est = estimateCostOfLiving({ rentFromPaise: 800_000, rentToPaise: 1_200_000, mealsIncluded: false, city: "Bengaluru" });
    expect(est.lines.map((l) => l.key)).toEqual(["rent", "food", "transport", "extras"]);
    const rent = est.lines.find((l) => l.key === "rent")!;
    expect(rent.fromPaise).toBe(800_000); // from live data, not computed
    expect(rent.toPaise).toBe(1_200_000);
    expect(est.totalToPaise).toBeGreaterThan(est.totalFromPaise); // a genuine range
  });

  it("drops the food cost when meals are included in rent", () => {
    const est = estimateCostOfLiving({ rentFromPaise: 800_000, mealsIncluded: true });
    const food = est.lines.find((l) => l.key === "food")!;
    expect(food.fromPaise).toBe(0);
    expect(food.toPaise).toBe(0);
    expect(food.note).toMatch(/included/i);
  });

  it("handles an unpriced area without pretending to know the rent", () => {
    const est = estimateCostOfLiving({ rentFromPaise: null, mealsIncluded: false });
    const rent = est.lines.find((l) => l.key === "rent")!;
    expect(rent.fromPaise).toBe(0);
    expect(rent.note).toMatch(/request/i);
    expect(est.isEstimate).toBe(true); // still an estimate
  });
});

describe("meals detection from amenities", () => {
  it("detects meal-like amenities", () => {
    expect(amenitiesIncludeMeals(["WiFi", "Food"])).toBe(true);
    expect(amenitiesIncludeMeals(["Mess", "AC"])).toBe(true);
    expect(amenitiesIncludeMeals(["WiFi", "AC", "Laundry"])).toBe(false);
  });
});
