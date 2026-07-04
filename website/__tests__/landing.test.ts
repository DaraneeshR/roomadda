import { describe, expect, it } from "vitest";
import type { AreaInsights } from "@roomadda/shared";
import { buildLandingContent, landingFilters, type LandingSpec } from "../lib/landing";
import { faqJsonLd, itemListJsonLd } from "../lib/seo";

const SPECS: LandingSpec[] = [
  { kind: "city", city: "Bengaluru" },
  { kind: "area", city: "Bengaluru", area: "Koramangala" },
  { kind: "intent", city: "Bengaluru", intent: "womens" },
  { kind: "intent", city: "Bengaluru", intent: "mens" },
  { kind: "landmark", city: "Bengaluru", area: "Nagavara", landmark: "Manyata Tech Park", landmarkSlug: "manyata-tech-park" },
];

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

describe("SEO landing engine — content", () => {
  it("gives every spec a UNIQUE H1", () => {
    const h1s = SPECS.map((s) => buildLandingContent(s).h1);
    expect(new Set(h1s).size).toBe(h1s.length);
    // Two intents in the same city are distinguished by the intent.
    expect(buildLandingContent(SPECS[2]!).h1).not.toBe(buildLandingContent(SPECS[3]!).h1);
  });

  it("writes 200+ words of real local copy for every page", () => {
    for (const spec of SPECS) {
      const content = buildLandingContent(spec);
      expect(wordCount(content.paragraphs.join(" "))).toBeGreaterThanOrEqual(200);
      expect(content.faqs.length).toBeGreaterThan(0);
    }
  });

  it("emits a stable canonical path per kind", () => {
    expect(buildLandingContent(SPECS[0]!).canonicalPath).toBe("/city/Bengaluru");
    expect(buildLandingContent(SPECS[1]!).canonicalPath).toBe("/area/Bengaluru/Koramangala");
    expect(buildLandingContent(SPECS[2]!).canonicalPath).toBe("/pg/womens/Bengaluru");
    expect(buildLandingContent(SPECS[4]!).canonicalPath).toBe("/near/Bengaluru/manyata-tech-park");
  });

  it("weaves live price bands into the copy + FAQ when insights are present", () => {
    const insights: AreaInsights = {
      area: "Koramangala",
      city: "Bengaluru",
      listingCount: 5,
      roomCount: 9,
      overall: { minPaise: 700_000, typicalPaise: 1_000_000, maxPaise: 1_500_000, avgPaise: 1_050_000, roomCount: 9 },
      byGender: [],
      byRoomType: [],
      histogram: [],
      generatedAt: new Date().toISOString(),
    };
    const content = buildLandingContent(SPECS[1]!, insights);
    const priceFaq = content.faqs.find((f) => /cost per month/i.test(f.q));
    expect(priceFaq?.a).toContain("₹7,000");
    expect(content.paragraphs[0]).toContain("₹10,000"); // typical rent in the lead copy
  });

  it("maps an intent to a real backend filter", () => {
    expect(landingFilters({ kind: "intent", city: "Pune", intent: "womens" })).toMatchObject({ city: "Pune", gender: "FEMALE" });
    expect(landingFilters({ kind: "area", city: "Pune", area: "Kharadi" })).toMatchObject({ city: "Pune", area: "Kharadi" });
  });
});

describe("SEO landing engine — JSON-LD builders", () => {
  it("builds a FAQPage from the FAQ set", () => {
    const spec = SPECS[1]!;
    const ld = faqJsonLd(buildLandingContent(spec).faqs) as Record<string, unknown>;
    expect(ld["@type"]).toBe("FAQPage");
    expect(Array.isArray(ld.mainEntity)).toBe(true);
    expect((ld.mainEntity as unknown[]).length).toBeGreaterThan(0);
  });

  it("builds an ItemList of absolute listing URLs", () => {
    const ld = itemListJsonLd([{ id: "abc", alias: "Sunrise PG" }], "PGs in Koramangala") as Record<string, unknown>;
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(1);
    const first = (ld.itemListElement as Array<Record<string, unknown>>)[0]!;
    expect(first.url).toMatch(/^https?:\/\/.+\/listing\/abc$/);
  });
});
