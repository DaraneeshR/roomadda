import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/hotels/search/route";

/**
 * The hotel search BFF forwards the date-range query to the backend and relays the
 * server-owned availability (real free-room counts + per-night price for those
 * exact dates). It is PUBLIC — browsing needs no auth (just-in-time KYC).
 */

let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL) => {
    capturedUrl = String(url);
    if (capturedUrl.includes("/v1/hotels/search")) return response();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedUrl = undefined;
});
afterEach(() => vi.unstubAllGlobals());

function searchRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/hotels/search${query}`, { method: "GET" });
}

describe("GET /api/hotels/search", () => {
  it("forwards the city + date range and returns real per-date availability", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                listing: { id: "l1", alias: "Skyline Suites", areaLabel: "MG Road", city: "Bengaluru", masked: true },
                categories: [
                  { categoryId: "c1", tier: "Deluxe", perNightPaise: 300_000, nights: 3, totalPaise: 900_000, availableRooms: 3, photos: [], amenities: [] },
                ],
              },
            ],
            nextCursor: null,
            checkIn: "2026-09-01",
            checkOut: "2026-09-04",
            nights: 3,
            guests: 2,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const res = await GET(searchRequest("?city=Bengaluru&checkIn=2026-09-01&checkOut=2026-09-04&guests=2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nights: number;
      items: { categories: { perNightPaise: number; availableRooms: number; totalPaise: number }[] }[];
    };
    // The response carries the resolved date range and the REAL availability + price.
    expect(body.nights).toBe(3);
    expect(body.items[0]!.categories[0]!.availableRooms).toBe(3);
    expect(body.items[0]!.categories[0]!.perNightPaise).toBe(300_000);
    expect(body.items[0]!.categories[0]!.totalPaise).toBe(900_000);

    // The exact date range was forwarded to the backend.
    expect(capturedUrl).toContain("/v1/hotels/search");
    expect(capturedUrl).toContain("checkIn=2026-09-01");
    expect(capturedUrl).toContain("checkOut=2026-09-04");
    expect(capturedUrl).toContain("guests=2");
  });

  it("relays a backend validation error (e.g. checkOut before checkIn)", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "checkOut must be after checkIn" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await GET(searchRequest("?city=Bengaluru&checkIn=2026-09-04&checkOut=2026-09-01"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});
