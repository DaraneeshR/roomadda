import { describe, it, expect } from "vitest";
import {
  assembleSocialProof,
  gateBookedRecently,
  gateScarcity,
  gateViewingNow,
  gateWishlisted,
  type SocialInputs,
} from "./social.logic.js";
import type { SocialConfig } from "./social.config.js";

const config: SocialConfig = {
  viewingFloor: 3,
  viewingTtlSeconds: 30,
  bookedFloor: 3,
  bookedWindowDays: 7,
  wishlistFloor: 5,
  scarcityAmberMax: 2,
};

/** Real, plentiful, unremarkable listing — nothing should surface. */
const quietInputs: SocialInputs = {
  viewingNow: 0,
  bookedCount: 0,
  bookedWindowDays: 7,
  availableBeds: 8,
  totalBeds: 10,
  wishlistedCount: 0,
};

describe("gateViewingNow (honesty floor)", () => {
  it("omits below the floor, shows at/above it", () => {
    expect(gateViewingNow(2, config)).toBeUndefined();
    expect(gateViewingNow(3, config)).toBe(3);
    expect(gateViewingNow(9, config)).toBe(9);
  });
  it("omits a zero count", () => {
    expect(gateViewingNow(0, config)).toBeUndefined();
  });
});

describe("gateBookedRecently (confirmed-paid count, floor + window)", () => {
  it("omits when the cron has never run (null window)", () => {
    expect(gateBookedRecently(10, null, config)).toBeUndefined();
  });
  it("omits below the floor, shows the real count + window at/above it", () => {
    expect(gateBookedRecently(2, 7, config)).toBeUndefined();
    expect(gateBookedRecently(3, 7, config)).toEqual({ count: 3, windowDays: 7 });
  });
  it("omits a zero count", () => {
    expect(gateBookedRecently(0, 7, config)).toBeUndefined();
  });
});

describe("gateScarcity (genuine live inventory)", () => {
  it("omits when there is no inventory at all", () => {
    expect(gateScarcity(0, 0, config)).toBeUndefined();
  });
  it("is red only when fully booked", () => {
    expect(gateScarcity(0, 10, config)).toEqual({ count: 0, level: "red" });
  });
  it("is amber when few beds remain (≤ amberMax, > 0)", () => {
    expect(gateScarcity(1, 10, config)).toEqual({ count: 1, level: "amber" });
    expect(gateScarcity(2, 10, config)).toEqual({ count: 2, level: "amber" });
  });
  it("omits when there is plenty of availability (no false urgency)", () => {
    expect(gateScarcity(3, 10, config)).toBeUndefined();
    expect(gateScarcity(10, 10, config)).toBeUndefined();
  });
});

describe("gateWishlisted (honesty floor)", () => {
  it("omits below the floor, shows at/above it", () => {
    expect(gateWishlisted(4, config)).toBeUndefined();
    expect(gateWishlisted(5, config)).toBe(5);
  });
});

describe("assembleSocialProof (only real, floor-cleared signals appear)", () => {
  it("returns an EMPTY object when nothing clears its floor — the honest 'show nothing'", () => {
    const social = assembleSocialProof(quietInputs, config);
    expect(social).toEqual({});
    // Every field is absent, not zero-filled — the client literally cannot fake it.
    for (const key of ["viewingNow", "bookedRecently", "bedsLeft", "wishlistedCount"]) {
      expect(social).not.toHaveProperty(key);
    }
  });

  it("includes only the widgets whose real value cleared the gate", () => {
    const social = assembleSocialProof(
      {
        viewingNow: 5, // ≥ 3 -> shown
        bookedCount: 2, // < 3 -> omitted
        bookedWindowDays: 7,
        availableBeds: 2, // ≤ 2 -> amber
        totalBeds: 10,
        wishlistedCount: 4, // < 5 -> omitted
      },
      config,
    );
    expect(social.viewingNow).toBe(5);
    expect(social.bedsLeft).toEqual({ count: 2, level: "amber" });
    expect(social).not.toHaveProperty("bookedRecently");
    expect(social).not.toHaveProperty("wishlistedCount");
  });

  it("surfaces every widget when all signals are genuinely strong", () => {
    const social = assembleSocialProof(
      {
        viewingNow: 12,
        bookedCount: 9,
        bookedWindowDays: 30,
        availableBeds: 0, // fully booked -> red
        totalBeds: 10,
        wishlistedCount: 20,
      },
      config,
    );
    expect(social).toEqual({
      viewingNow: 12,
      bookedRecently: { count: 9, windowDays: 30 },
      bedsLeft: { count: 0, level: "red" },
      wishlistedCount: 20,
    });
  });
});
