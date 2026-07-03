import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as bookingsList } from "../app/api/bookings/route";
import { GET as activeStay } from "../app/api/me/active-stay/route";

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

function authed(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer access-tok" } });
}

describe("My Bookings — list reads the REAL backend endpoint", () => {
  it("forwards pagination + bearer and relays the same BookingDetail items", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            items: [{ id: "b1", status: "CONFIRMED", listing: { masked: false }, hostName: "Harish Host" }],
            nextCursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await bookingsList(authed("/api/bookings?limit=20"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; hostName: string }> };
    expect(body.items[0]?.id).toBe("b1");
    expect(body.items[0]?.hostName).toBe("Harish Host");
    expect(capturedUrl).toContain("/v1/bookings?limit=20");
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
  });

  it("rejects an unauthenticated list before contacting the backend", async () => {
    stub(() => new Response(null, { status: 200 }));
    const res = await bookingsList(new NextRequest("http://localhost/api/bookings"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Dashboard — active-stay reads the REAL backend endpoint", () => {
  it("relays the active stay (with the allowed host emergency contact)", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            activeStay: { bookingId: "b1", pgName: "Sunrise Residency", host: { name: "Harish", emergencyContactNumber: "+919000000002" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await activeStay(authed("/api/me/active-stay"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activeStay: { pgName: string } | null };
    expect(body.activeStay?.pgName).toBe("Sunrise Residency");
    expect(capturedUrl).toContain("/v1/me/active-stay");
  });

  it("relays a null active stay (pre-move-in) unchanged", async () => {
    stub(() => new Response(JSON.stringify({ activeStay: null }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await activeStay(authed("/api/me/active-stay"));
    const body = (await res.json()) as { activeStay: null };
    expect(body.activeStay).toBeNull();
  });
});
