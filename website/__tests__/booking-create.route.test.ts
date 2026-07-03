import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/bookings/route";

const ROOM_ID = "20000000-0000-4000-8000-000000000011";

let capturedInit: RequestInit | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    if (String(url).includes("/v1/bookings")) {
      capturedInit = init;
      return response();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedInit = undefined;
});
afterEach(() => vi.unstubAllGlobals());

function bookRequest(body: unknown, auth = true): NextRequest {
  return new NextRequest("http://localhost/api/bookings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer access-tok" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bookings (create hold)", () => {
  it("forwards the hold to the backend with the caller's bearer, never confirming", () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ booking: { id: "booking-1", status: "TOKEN_PENDING", tokenAmountPaise: 200_000 } }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );

    return POST(bookRequest({ roomId: ROOM_ID, moveInDate: "2026-08-01" })).then(async (res) => {
      expect(res.status).toBe(201);
      const data = (await res.json()) as { booking: { status: string } };
      // A fresh hold is TOKEN_PENDING — NOT confirmed (webhook owns that).
      expect(data.booking.status).toBe("TOKEN_PENDING");
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/bookings");
      expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
      expect(JSON.parse(String(capturedInit?.body)).roomId).toBe(ROOM_ID);
    });
  });

  it("rejects an unauthenticated hold before contacting the backend", async () => {
    stub(() => new Response(null, { status: 201 }));
    const res = await POST(bookRequest({ roomId: ROOM_ID }, false));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (needs exactly one of roomId/bedId) before the backend", async () => {
    stub(() => new Response(null, { status: 201 }));
    const res = await POST(bookRequest({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the backend's KYC gate (403 KYC_REQUIRED) — the web flow never bypasses it", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ error: { code: "KYC_REQUIRED", message: "KYC verification is required for this action" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await POST(bookRequest({ roomId: ROOM_ID }));
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("KYC_REQUIRED");
  });
});
