import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/bookings/[id]/route";

const BOOKING_ID = "aaaaaaaa-0000-4000-8000-000000000001";

let capturedInit: RequestInit | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    if (String(url).includes(`/v1/bookings/${BOOKING_ID}`)) {
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

function statusRequest(auth = true): NextRequest {
  return new NextRequest(`http://localhost/api/bookings/${BOOKING_ID}`, {
    method: "GET",
    headers: auth ? { authorization: "Bearer access-tok" } : {},
  });
}
const params = { params: Promise.resolve({ id: BOOKING_ID }) };

describe("GET /api/bookings/:id (confirmation poll target)", () => {
  it("relays the MASKED booking (no host) while still pending", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ booking: { id: BOOKING_ID, status: "TOKEN_PENDING", hostName: null, listing: { masked: true } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await GET(statusRequest(), params);
    expect(res.status).toBe(200);
    const { booking } = (await res.json()) as { booking: { hostName: null; listing: { masked: boolean } } };
    expect(booking.hostName).toBeNull();
    expect(booking.listing.masked).toBe(true);
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
  });

  it("relays the REVEALED booking (host + unmasked) once the server reports CONFIRMED", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            booking: { id: BOOKING_ID, status: "CONFIRMED", hostName: "Harish Host", listing: { masked: false } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await GET(statusRequest(), params);
    const { booking } = (await res.json()) as { booking: { status: string; hostName: string; listing: { masked: boolean } } };
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.hostName).toBe("Harish Host");
    expect(booking.listing.masked).toBe(false);
  });

  it("rejects an unauthenticated poll before contacting the backend", async () => {
    stub(() => new Response(null, { status: 200 }));
    const res = await GET(statusRequest(false), params);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
