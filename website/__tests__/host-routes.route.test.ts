import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listListings } from "../app/api/host/listings/route";
import { PATCH as editListing } from "../app/api/host/listings/[id]/route";
import { POST as submitListing } from "../app/api/host/listings/[id]/submit/route";
import { GET as getRoster } from "../app/api/host/listings/[id]/roster/route";
import { POST as declineRequest } from "../app/api/host/booking-requests/[id]/decline/route";
import { POST as uploadPhoto } from "../app/api/host/listings/[id]/photos/upload/route";

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Route backend calls by URL; each entry returns a Response for a matcher. */
function stub(routes: Array<{ match: (u: string) => boolean; res: () => Response }>): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = routes.find((r) => r.match(u));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    return hit.res();
  });
  vi.stubGlobal("fetch", fetchMock);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Narrow init (no `signal`) so it matches Next's RequestInit, not DOM's. */
type ReqInit = { method?: string; headers?: HeadersInit; body?: BodyInit | null };

function authed(path: string, init: ReqInit = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer host-tok" }, ...init });
}

function anon(path: string, init: ReqInit = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("host portal is auth-gated at the BFF (never reaches the backend anonymously)", () => {
  it("rejects an unauthenticated listings read before contacting the backend", async () => {
    stub([{ match: () => true, res: () => json({}) }]);
    const res = await listListings(anon("/api/host/listings"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated photo upload before contacting the backend", async () => {
    stub([{ match: () => true, res: () => json({}) }]);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/jpeg" }), "p.jpg");
    const res = await uploadPhoto(anon("/api/host/listings/L1/photos/upload", { method: "POST", body: form }), {
      params: Promise.resolve({ id: "L1" }),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("host listings — forwards bearer + query and relays", () => {
  it("proxies GET /v1/host/listings with the caller's token and pagination", async () => {
    stub([{ match: (u) => u.includes("/v1/host/listings"), res: () => json({ items: [{ id: "L1" }], nextCursor: null }) }]);
    const res = await listListings(authed("/api/host/listings?limit=50"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items[0]?.id).toBe("L1");
    expect(calls[0]?.url).toContain("/v1/host/listings?limit=50");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer host-tok");
  });
});

describe("tenant roster — relays exactly, and NEVER carries KYC", () => {
  it("passes the roster shape through untouched (name/room/move-in/rent status only)", async () => {
    const rosterItem = {
      kind: "BOOKING",
      id: "t1",
      name: "Asha Tenant",
      roomName: "Room 101",
      moveInDate: "2026-06-01T00:00:00.000Z",
      monthlyRentPaise: 1_200_000,
      rentStatus: "PAID",
      moveOutDate: null,
      durationDays: null,
    };
    stub([{ match: (u) => u.includes("/v1/host/listings/L1/roster"), res: () => json({ items: [rosterItem], nextCursor: null }) }]);

    const res = await getRoster(authed("/api/host/listings/L1/roster?scope=current"), { params: Promise.resolve({ id: "L1" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toEqual(rosterItem);

    // Not one KYC / identity field ever crosses the boundary.
    const keys = Object.keys(body.items[0] ?? {});
    for (const forbidden of ["aadhaarNumber", "aadhaarLast4", "kyc", "documents", "dateOfBirth", "phone", "gender"]) {
      expect(keys).not.toContain(forbidden);
    }
    // The scope query was forwarded.
    expect(calls[0]?.url).toContain("scope=current");
  });

  it("surfaces the backend's ownership 404 for a foreign listing (never fabricates data)", async () => {
    stub([
      {
        match: (u) => u.includes("/v1/host/listings/OTHER/roster"),
        res: () => json({ error: { code: "LISTING_NOT_FOUND", message: "Listing not found" } }, 404),
      },
    ]);
    const res = await getRoster(authed("/api/host/listings/OTHER/roster"), { params: Promise.resolve({ id: "OTHER" }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("LISTING_NOT_FOUND");
  });
});

describe("edit listing — relays the server's re-queue verdict", () => {
  it("returns requeued:true when an address edit re-queued a live listing", async () => {
    stub([
      {
        match: (u) => u.includes("/v1/host/listings/L1"),
        res: () => json({ listing: { id: "L1" }, requeued: true, changedFields: ["fullAddress"] }),
      },
    ]);
    const res = await editListing(
      authed("/api/host/listings/L1", {
        method: "PATCH",
        headers: { authorization: "Bearer host-tok", "content-type": "application/json" },
        body: JSON.stringify({ fullAddress: "99 New Road, Indiranagar" }),
      }),
      { params: Promise.resolve({ id: "L1" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requeued: boolean; changedFields: string[] };
    expect(body.requeued).toBe(true);
    expect(body.changedFields).toEqual(["fullAddress"]);
    // The changed field was forwarded to the host edit endpoint.
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ fullAddress: "99 New Road, Indiranagar" });
  });
});

describe("submit for review — server-fixed status, client cannot override", () => {
  it("PATCHes /v1/listings with a hardcoded PENDING_REVIEW body", async () => {
    stub([{ match: (u) => u.includes("/v1/listings/L1"), res: () => json({ listing: { id: "L1", status: "PENDING_REVIEW" } }) }]);
    const res = await submitListing(authed("/api/host/listings/L1/submit", { method: "POST" }), {
      params: Promise.resolve({ id: "L1" }),
    });
    expect(res.status).toBe(200);
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ status: "PENDING_REVIEW" });
  });
});

describe("decline booking request — forwards the optional reason", () => {
  it("relays a decline with a reason", async () => {
    stub([{ match: (u) => u.includes("/v1/host/booking-requests/B1/decline"), res: () => json({ refundId: "rf1" }) }]);
    const res = await declineRequest(
      authed("/api/host/booking-requests/B1/decline", {
        method: "POST",
        headers: { authorization: "Bearer host-tok", "content-type": "application/json" },
        body: JSON.stringify({ reason: "Room no longer available" }),
      }),
      { params: Promise.resolve({ id: "B1" }) },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ reason: "Room no longer available" });
  });

  it("accepts an empty decline body", async () => {
    stub([{ match: (u) => u.includes("/v1/host/booking-requests/B1/decline"), res: () => json({ refundId: "rf1" }) }]);
    const res = await declineRequest(
      authed("/api/host/booking-requests/B1/decline", {
        method: "POST",
        headers: { authorization: "Bearer host-tok", "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "B1" }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("listing photo upload — presign, PUT to the bucket, then attach", () => {
  const UPLOAD_URL = "https://listing-photos.stub.local/listings/L1/abc.jpg?sig=1";
  const PUBLIC_URL = "https://cdn.stub.local/listings/L1/abc.jpg";

  function photoForm(type = "image/jpeg"): FormData {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type }), "photo.jpg");
    return form;
  }

  it("runs the three server-side hops and returns the attached photo", async () => {
    stub([
      { match: (u) => u.includes("/v1/listings/L1/photos/upload-url"), res: () => json({ key: "listings/L1/abc.jpg", uploadUrl: UPLOAD_URL, publicUrl: PUBLIC_URL, expiresInSeconds: 900 }, 201) },
      { match: (u) => u === UPLOAD_URL, res: () => new Response(null, { status: 200 }) },
      { match: (u) => u.endsWith("/v1/listings/L1/photos"), res: () => json({ photo: { id: "ph1", url: PUBLIC_URL, isPrimary: true, sortOrder: 0 } }, 201) },
    ]);

    const res = await uploadPhoto(authed("/api/host/listings/L1/photos/upload", { method: "POST", body: photoForm() }), {
      params: Promise.resolve({ id: "L1" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { photo: { id: string; url: string } };
    expect(body.photo.id).toBe("ph1");

    // 1) presign, 2) PUT the bytes to the bucket, 3) attach the public URL.
    expect(calls[0]?.url).toContain("/v1/listings/L1/photos/upload-url");
    expect(calls[1]?.url).toBe(UPLOAD_URL);
    expect(calls[1]?.init.method).toBe("PUT");
    expect(new Headers(calls[1]?.init.headers).get("content-type")).toBe("image/jpeg");
    expect(calls[2]?.url).toContain("/v1/listings/L1/photos");
    expect(JSON.parse(String(calls[2]?.init.body)).url).toBe(PUBLIC_URL);
  });

  it("rejects an unsupported photo type before any backend call", async () => {
    stub([{ match: () => true, res: () => json({}) }]);
    const res = await uploadPhoto(authed("/api/host/listings/L1/photos/upload", { method: "POST", body: photoForm("image/gif") }), {
      params: Promise.resolve({ id: "L1" }),
    });
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
