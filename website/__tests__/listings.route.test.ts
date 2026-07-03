import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGet } from "../app/api/listings/route";
import { GET as nearbyGet } from "../app/api/listings/nearby/route";

/**
 * The public listing BFF proxies. The browser filters LIVE by hitting these
 * same-origin routes (CSP `connect-src 'self'`); they relay the query string to
 * the backend's masked public endpoints — no auth, discovery is open.
 */

let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(status: number, body: unknown): void {
  fetchMock = vi.fn(async (url: string | URL) => {
    capturedUrl = String(url);
    return new Response(body === null ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => (capturedUrl = undefined));
afterEach(() => vi.unstubAllGlobals());

const req = (path: string): NextRequest => new NextRequest(`http://localhost${path}`, { method: "GET" });

describe("GET /api/listings — live filter proxy", () => {
  it("forwards the full filter query to /v1/listings and returns the page", async () => {
    stub(200, { items: [{ id: "l1" }], nextCursor: "cur" });
    const res = await listGet(req("/api/listings?city=Pune&gender=FEMALE&amenities=WiFi,AC&limit=24"));
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/v1/listings?");
    expect(capturedUrl).toContain("city=Pune");
    expect(capturedUrl).toContain("gender=FEMALE");
    // The proxy relays the raw query string verbatim (comma left unencoded).
    expect(capturedUrl).toContain("amenities=WiFi,AC");
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBe("cur");
  });

  it("relays a backend error status instead of leaking internals", async () => {
    stub(400, { error: { code: "VALIDATION", message: "bad query" } });
    const res = await listGet(req("/api/listings?minRentPaise=abc"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("VALIDATION");
  });
});

describe("GET /api/listings/nearby — map 'search this area' proxy", () => {
  it("forwards lat/lng/radius to the backend nearby search", async () => {
    stub(200, { items: [{ id: "l1", distanceMeters: 300 }], nextCursor: null });
    const res = await nearbyGet(req("/api/listings/nearby?lat=12.9&lng=77.6&radiusM=1500&limit=24"));
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/v1/listings/search/nearby?");
    expect(capturedUrl).toContain("lat=12.9");
    expect(capturedUrl).toContain("radiusM=1500");
  });
});
