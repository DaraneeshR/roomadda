import { describe, it, expect } from "vitest";
import { badgeConfig } from "./badge.config.js";
import { evaluateBadges, type BadgeSignals } from "./badge.rules.js";

/** Signals that clear EVERY rule — the baseline we knock conditions out of. */
const fullyQualified: BadgeSignals = {
  inspectionApproved: true,
  hostKycVerified: true,
  listingPhotoCount: 10,
  amenitiesMatched: true,
  hostResponseRate: 1,
  unresolvedEscalations: 0,
  ratingAverage: 4.8,
  ratingCount: 30,
  areaPriceTopQuartile: true,
  premiumAmenityCount: 3,
  assuredMonths: 12,
  completedStays: 40,
  cancellationRate: 0.01,
  confirmedBookingsInWindow: 10,
  bookedThisWeek: 5,
  momentumTopDecile: true,
};

const evaluate = (over: Partial<BadgeSignals>) =>
  evaluateBadges({ ...fullyQualified, ...over }, badgeConfig);

describe("evaluateBadges — full qualification", () => {
  it("earns every rule badge when all signals are strong", () => {
    const earned = evaluate({});
    expect([...earned].sort()).toEqual(
      ["LUXURY", "RA_ASSURED", "RA_CHOICE", "RA_VERIFIED", "TRENDING", "WIZARD"].sort(),
    );
  });
});

describe("RA Verified gates the chain", () => {
  it("no Verified without host KYC -> nothing above Trending", () => {
    const earned = evaluate({ hostKycVerified: false });
    expect(earned.has("RA_VERIFIED")).toBe(false);
    expect(earned.has("RA_ASSURED")).toBe(false);
    // Trending is momentum-based and independent of the trust ladder.
    expect(earned.has("TRENDING")).toBe(true);
  });

  it("no Verified without an approved inspection", () => {
    expect(evaluate({ inspectionApproved: false }).has("RA_VERIFIED")).toBe(false);
  });
});

describe("RA-Assured requires ALL of its conditions", () => {
  it("earns RA-Assured only when every condition holds", () => {
    expect(evaluate({}).has("RA_ASSURED")).toBe(true);
  });

  it.each<[string, Partial<BadgeSignals>]>([
    ["too few photos", { listingPhotoCount: 7 }],
    ["amenities not matched", { amenitiesMatched: false }],
    ["response rate below 90%", { hostResponseRate: 0.89 }],
    ["an unresolved escalation", { unresolvedEscalations: 1 }],
    ["not RA-Verified", { hostKycVerified: false }],
  ])("does NOT earn RA-Assured when %s", (_label, over) => {
    const earned = evaluate(over);
    expect(earned.has("RA_ASSURED")).toBe(false);
    // Every higher badge depends on Assured, so they all fall too.
    expect(earned.has("RA_CHOICE")).toBe(false);
    expect(earned.has("LUXURY")).toBe(false);
    expect(earned.has("WIZARD")).toBe(false);
  });

  it("LOSES RA-Assured the moment response rate drops below the floor", () => {
    expect(evaluate({ hostResponseRate: 0.95 }).has("RA_ASSURED")).toBe(true);
    expect(evaluate({ hostResponseRate: 0.85 }).has("RA_ASSURED")).toBe(false);
  });
});

describe("higher badges each need their own bar on top of Assured", () => {
  it("RA Choice needs rating ≥4.5, enough reviews, conversion, fast response", () => {
    expect(evaluate({ ratingAverage: 4.4 }).has("RA_CHOICE")).toBe(false);
    expect(evaluate({ ratingCount: 2 }).has("RA_CHOICE")).toBe(false);
    expect(evaluate({ confirmedBookingsInWindow: 0 }).has("RA_CHOICE")).toBe(false);
    expect(evaluate({ hostResponseRate: 0.9 }).has("RA_CHOICE")).toBe(false); // 0.9 < fast(0.95)
  });

  it("Luxury needs top-quartile price + premium amenities + rating ≥4.5", () => {
    expect(evaluate({ areaPriceTopQuartile: false }).has("LUXURY")).toBe(false);
    expect(evaluate({ premiumAmenityCount: 1 }).has("LUXURY")).toBe(false);
    expect(evaluate({ ratingAverage: 4.4 }).has("LUXURY")).toBe(false);
  });

  it("Wizard needs ≥6mo Assured, ≥20 stays, rating ≥4.6, <5% cancellation", () => {
    expect(evaluate({ assuredMonths: 5 }).has("WIZARD")).toBe(false);
    expect(evaluate({ completedStays: 19 }).has("WIZARD")).toBe(false);
    expect(evaluate({ ratingAverage: 4.5 }).has("WIZARD")).toBe(false);
    expect(evaluate({ cancellationRate: 0.06 }).has("WIZARD")).toBe(false);
  });
});

describe("Trending — momentum only, time-independent of the ladder", () => {
  it("earns via booked ≥3 this week OR top-decile momentum", () => {
    expect(evaluate({ momentumTopDecile: false, bookedThisWeek: 3 }).has("TRENDING")).toBe(true);
    expect(evaluate({ momentumTopDecile: true, bookedThisWeek: 0 }).has("TRENDING")).toBe(true);
  });

  it("is NOT trending when momentum fades and bookings are below the bar", () => {
    expect(evaluate({ momentumTopDecile: false, bookedThisWeek: 2 }).has("TRENDING")).toBe(false);
  });
});
