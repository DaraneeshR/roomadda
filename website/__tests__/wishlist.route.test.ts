import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, POST } from "../app/api/wishlist/[listingId]/route";
import { GET } from "../app/api/wishlist/route";

const LISTING_ID = "10000000-0000-4000-8000-000000000001";

let capturedUrl: string | undefined;
let capturedInit: RequestInit | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return response();
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedUrl = undefined;
  capturedInit = undefined;
});
afterEach(() => vi.unstubAllGlobals());

const params = { params: Promise.resolve({ listingId: LISTING_ID }) };

function req(path: string, method: string, auth = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: auth ? { authorization: "Bearer access-tok" } : {},
  });
}

describe("wishlist — writes to the SHARED account (same identity as the app)", () => {
  it("saves via the per-user backend endpoint with the caller's bearer", async () => {
    stub(() => new Response(JSON.stringify({ listingId: LISTING_ID, saved: true }), { status: 201 }));
    const res = await POST(req(`/api/wishlist/${LISTING_ID}`, "POST"), params);
    expect(res.status).toBe(201);
    // The bearer is the phone-keyed session token → the SAME account the app uses;
    // the backend's (userId,listingId) upsert makes a repeat save a no-op (no dup).
    expect(capturedUrl).toContain(`/v1/wishlist/${LISTING_ID}`);
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
  });

  it("removes via the same per-user endpoint and returns 204", async () => {
    stub(() => new Response(null, { status: 204 }));
    const res = await DELETE(req(`/api/wishlist/${LISTING_ID}`, "DELETE"), params);
    expect(res.status).toBe(204);
    expect(capturedInit?.method).toBe("DELETE");
    expect(capturedUrl).toContain(`/v1/wishlist/${LISTING_ID}`);
  });

  it("lists the caller's saved listings, forwarding pagination", async () => {
    stub(() => new Response(JSON.stringify({ items: [{ id: LISTING_ID }], nextCursor: null }), { status: 200 }));
    const res = await GET(req(`/api/wishlist?limit=50`, "GET"));
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/v1/wishlist?limit=50");
  });

  it("rejects an unauthenticated save and a bad listing id", async () => {
    stub(() => new Response(null, { status: 201 }));
    const unauth = await POST(req(`/api/wishlist/${LISTING_ID}`, "POST", false), params);
    expect(unauth.status).toBe(401);

    const badParams = { params: Promise.resolve({ listingId: "not-a-uuid" }) };
    const bad = await POST(req(`/api/wishlist/not-a-uuid`, "POST"), badParams);
    expect(bad.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
