import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AreaInsights } from "@roomadda/shared";

/**
 * SEO landing pages must SERVER-RENDER real HTML: a unique H1, the templated copy,
 * an FAQ, and JSON-LD — all without a session. We mock the public API layer so the
 * page fetches nothing live, then render the returned tree to static markup and
 * assert the crawlable bits are present.
 */
const insights: AreaInsights = {
  area: "Koramangala",
  city: "Bengaluru",
  listingCount: 4,
  roomCount: 6,
  overall: { minPaise: 700_000, typicalPaise: 1_000_000, maxPaise: 1_500_000, avgPaise: 1_050_000, roomCount: 6 },
  byGender: [],
  byRoomType: [],
  histogram: [],
  generatedAt: "2026-07-04T00:00:00.000Z",
};

vi.mock("../lib/api", () => ({
  publicApi: {
    areaInsights: vi.fn(async () => insights),
    listings: vi.fn(async () => ({ items: [], nextCursor: null })),
    listing: vi.fn(),
    featured: vi.fn(),
    nearby: vi.fn(async () => ({ items: [] })),
    reviews: vi.fn(),
  },
}));

// next/link renders an anchor for static markup (no router context in the test).
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={String(href)}>{children}</a>,
}));

const AreaLandingPage = (await import("../app/area/[city]/[area]/page")).default;
const CityPage = (await import("../app/city/[city]/page")).default;
const IntentLandingPage = (await import("../app/pg/[intent]/[city]/page")).default;

describe("SEO landing pages SSR", () => {
  it("renders the area page with a unique H1, JSON-LD, FAQ and price insights", async () => {
    const el = await AreaLandingPage({ params: Promise.resolve({ city: "Bengaluru", area: "Koramangala" }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain("PG accommodation in Koramangala, Bengaluru"); // unique H1
    expect(html).toContain("application/ld+json"); // structured data emitted
    expect(html).toContain("FAQPage"); // FAQ JSON-LD
    expect(html).toContain("Frequently asked questions"); // visible FAQ
    expect(html).toContain("Prices in Koramangala"); // live insights panel
  });

  it("renders the city page and gives it a DIFFERENT H1 from the area page", async () => {
    const cityHtml = renderToStaticMarkup(await CityPage({ params: Promise.resolve({ city: "Bengaluru" }) }));
    expect(cityHtml).toContain("PG accommodation in Bengaluru");
    expect(cityHtml).not.toContain("PG accommodation in Koramangala, Bengaluru");
    expect(cityHtml).toContain("application/ld+json");
  });

  it("renders an intent page with its own H1", async () => {
    const html = renderToStaticMarkup(await IntentLandingPage({ params: Promise.resolve({ intent: "womens", city: "Bengaluru" }) }));
    expect(html).toContain("Women&#x27;s PGs in Bengaluru");
    expect(html).toContain("application/ld+json");
  });
});
