import { describe, it, expect } from "vitest";
import type { TrustBadgeKind, TrustBadgeSource } from "@roomadda/shared";
import { buildBadgeView, isActiveBadge, sortByPriority, topBadges } from "./badge.serializer.js";

const NOW = new Date("2026-07-04T00:00:00.000Z");
const PAST = new Date("2026-07-01T00:00:00.000Z");
const FUTURE = new Date("2026-07-10T00:00:00.000Z");

type Tag = {
  kind: TrustBadgeKind;
  source: TrustBadgeSource;
  earnedAt: Date;
  expiresAt: Date | null;
  suspended: boolean;
};
const tag = (kind: TrustBadgeKind, over: Partial<Tag> = {}): Tag => ({
  kind,
  source: "RULE",
  earnedAt: PAST,
  expiresAt: null,
  suspended: false,
  ...over,
});

describe("isActiveBadge", () => {
  it("is inactive when suspended or expired, active otherwise", () => {
    expect(isActiveBadge({ suspended: false, expiresAt: null }, NOW)).toBe(true);
    expect(isActiveBadge({ suspended: false, expiresAt: FUTURE }, NOW)).toBe(true);
    expect(isActiveBadge({ suspended: true, expiresAt: null }, NOW)).toBe(false);
    expect(isActiveBadge({ suspended: false, expiresAt: PAST }, NOW)).toBe(false);
  });
});

describe("sortByPriority", () => {
  it("orders by card priority, highest first", () => {
    const ordered = sortByPriority([
      { kind: "TRENDING" as const },
      { kind: "WIZARD" as const },
      { kind: "RA_VERIFIED" as const },
      { kind: "LUXURY" as const },
    ]);
    expect(ordered.map((b) => b.kind)).toEqual(["WIZARD", "LUXURY", "RA_VERIFIED", "TRENDING"]);
  });
});

describe("buildBadgeView", () => {
  it("returns active badges ordered by priority, hiding suspended + expired", () => {
    const { badges } = buildBadgeView({
      now: NOW,
      instantBookEligible: false,
      tags: [
        tag("RA_VERIFIED"),
        tag("WIZARD"),
        tag("TRENDING", { expiresAt: PAST }), // expired -> hidden
        tag("LUXURY", { suspended: true }), // suspended -> hidden
      ],
    });
    expect(badges.map((b) => b.kind)).toEqual(["WIZARD", "RA_VERIFIED"]);
  });

  it("splits FEATURED out of the list but reports it via `featured`", () => {
    const { badges, featured } = buildBadgeView({
      now: NOW,
      instantBookEligible: false,
      tags: [tag("FEATURED", { source: "ADMIN" }), tag("RA_ASSURED")],
    });
    expect(featured).toBe(true);
    expect(badges.map((b) => b.kind)).toEqual(["RA_ASSURED"]);
    expect(badges.some((b) => b.kind === "FEATURED")).toBe(false);
  });

  it("adds the live-derived INSTANT_BOOK (lowest priority) only when eligible", () => {
    const eligible = buildBadgeView({ now: NOW, instantBookEligible: true, tags: [tag("RA_ASSURED")] });
    expect(eligible.badges.map((b) => b.kind)).toEqual(["RA_ASSURED", "INSTANT_BOOK"]);

    const notEligible = buildBadgeView({ now: NOW, instantBookEligible: false, tags: [tag("RA_ASSURED")] });
    expect(notEligible.badges.some((b) => b.kind === "INSTANT_BOOK")).toBe(false);
  });

  it("serializes earnedAt/expiresAt as ISO strings", () => {
    const { badges } = buildBadgeView({
      now: NOW,
      instantBookEligible: false,
      tags: [tag("TRENDING", { earnedAt: PAST, expiresAt: FUTURE })],
    });
    expect(badges[0]).toMatchObject({
      kind: "TRENDING",
      earnedAt: PAST.toISOString(),
      expiresAt: FUTURE.toISOString(),
    });
  });
});

describe("topBadges (cards show the top 2–3)", () => {
  it("keeps only the first N after priority sorting", () => {
    const { badges } = buildBadgeView({
      now: NOW,
      instantBookEligible: true,
      tags: [tag("WIZARD"), tag("LUXURY"), tag("RA_ASSURED"), tag("RA_VERIFIED")],
    });
    // Full detail order: WIZARD, LUXURY, RA_ASSURED, RA_VERIFIED, INSTANT_BOOK.
    expect(topBadges(badges, 3).map((b) => b.kind)).toEqual(["WIZARD", "LUXURY", "RA_ASSURED"]);
  });
});
