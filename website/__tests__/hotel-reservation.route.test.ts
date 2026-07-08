import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createHold } from "../app/api/hotels/reservations/route";
import { POST as pay } from "../app/api/hotels/reservations/[id]/payment/route";

/**
 * The hotel reservation BFF mirrors the PG booking BFF: it forwards the caller's
 * bearer, a fresh hold is HELD (never CONFIRMED — the webhook owns that), the
 * payment order carries only the PUBLIC key id, and the backend KYC gate is
 * surfaced, never bypassed. The client sends ONLY dates/category — never a price.
 */

const RES_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const CATEGORY_ID = "cccccccc-0000-4000-8000-000000000001";

let capturedInit: RequestInit | undefined;
let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(match: string, response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    capturedUrl = String(url);
    if (capturedUrl.includes(match)) {
      capturedInit = init;
      return response();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedInit = undefined;
  capturedUrl = undefined;
});
afterEach(() => vi.unstubAllGlobals());

function holdRequest(body: unknown, auth = true): NextRequest {
  return new NextRequest("http://localhost/api/hotels/reservations", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer access-tok" } : {}) },
    body: JSON.stringify(body),
  });
}
function payRequest(auth = true): NextRequest {
  return new NextRequest(`http://localhost/api/hotels/reservations/${RES_ID}/payment`, {
    method: "POST",
    headers: { ...(auth ? { authorization: "Bearer access-tok" } : {}) },
  });
}
const payParams = { params: Promise.resolve({ id: RES_ID }) };

const validHold = { categoryId: CATEGORY_ID, checkIn: "2026-09-01", checkOut: "2026-09-04", guests: 2 };

describe("POST /api/hotels/reservations (hold)", () => {
  it("forwards the hold with the bearer and returns a HELD reservation (never confirmed)", async () => {
    stub(
      "/v1/hotels/reservations",
      () =>
        new Response(
          JSON.stringify({ reservation: { id: RES_ID, status: "HELD", tokenAmountPaise: 900_000, qrCodeToken: null } }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );

    const res = await createHold(holdRequest(validHold));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { reservation: { status: string; qrCodeToken: string | null } };
    // A fresh hold is HELD with NO check-in code — confirmation is webhook-only.
    expect(data.reservation.status).toBe("HELD");
    expect(data.reservation.qrCodeToken).toBeNull();

    expect(capturedUrl).toContain("/v1/hotels/reservations");
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
    // Only dates + category are forwarded — no price/amount field exists.
    const forwarded = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(forwarded.categoryId).toBe(CATEGORY_ID);
    expect(forwarded).not.toHaveProperty("perNightPaise");
    expect(forwarded).not.toHaveProperty("totalPaise");
    expect(forwarded).not.toHaveProperty("amountPaise");
  });

  it("rejects an unauthenticated hold before contacting the backend", async () => {
    stub("/v1/hotels/reservations", () => new Response(null, { status: 201 }));
    const res = await createHold(holdRequest(validHold, false));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (missing categoryId) before the backend", async () => {
    stub("/v1/hotels/reservations", () => new Response(null, { status: 201 }));
    const res = await createHold(holdRequest({ checkIn: "2026-09-01", checkOut: "2026-09-04" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body carrying a price (strict schema) — money can't be client-set", async () => {
    stub("/v1/hotels/reservations", () => new Response(null, { status: 201 }));
    const res = await createHold(holdRequest({ ...validHold, perNightPaise: 1 }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the backend KYC gate (403 KYC_REQUIRED) — never bypassed", async () => {
    stub(
      "/v1/hotels/reservations",
      () =>
        new Response(
          JSON.stringify({ error: { code: "KYC_REQUIRED", message: "KYC verification is required for this action" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await createHold(holdRequest(validHold));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("KYC_REQUIRED");
  });
});

describe("POST /api/hotels/reservations/:id/payment", () => {
  it("creates the order with the bearer + NO body and returns the PUBLIC key id (no secret)", async () => {
    stub(
      `/v1/hotels/reservations/${RES_ID}/payment`,
      () =>
        new Response(
          JSON.stringify({
            reservationId: RES_ID,
            amountPaise: 900_000,
            razorpayOrder: { orderId: "order_stub_1", amount: 900_000, currency: "INR", keyId: "rzp_test_public" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );

    const res = await pay(payRequest(), payParams);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { razorpayOrder: { keyId: string } };
    expect(data.razorpayOrder.keyId).toBe("rzp_test_public");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("secret");

    // Forwarded to the reservation's payment endpoint with the bearer and NO body
    // (the amount is server-owned, never sent by the client).
    expect(capturedUrl).toContain(`/v1/hotels/reservations/${RES_ID}/payment`);
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
    expect(capturedInit?.body).toBeUndefined();
  });

  it("rejects an unauthenticated payment before contacting the backend", async () => {
    stub(`/v1/hotels/reservations/${RES_ID}/payment`, () => new Response(null, { status: 201 }));
    const res = await pay(payRequest(false), payParams);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
