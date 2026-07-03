import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/bookings/[id]/payment/route";

const BOOKING_ID = "aaaaaaaa-0000-4000-8000-000000000001";

let capturedInit: RequestInit | undefined;
let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: () => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    capturedUrl = String(url);
    if (capturedUrl.includes(`/v1/bookings/${BOOKING_ID}/payment`)) {
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

function payRequest(body: unknown, auth = true): NextRequest {
  return new NextRequest(`http://localhost/api/bookings/${BOOKING_ID}/payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer access-tok" } : {}),
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: BOOKING_ID }) };

describe("POST /api/bookings/:id/payment", () => {
  it("forwards the ONLINE token order and returns the PUBLIC key id (never a secret)", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            paymentId: "pay-1",
            amountPaise: 200_000,
            razorpayOrder: { orderId: "order_stub_1", amount: 200_000, currency: "INR", keyId: "rzp_test_public" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );

    const res = await POST(payRequest({ method: "ONLINE", onlinePaise: 200_000, cashPaise: 0 }), params);

    expect(res.status).toBe(201);
    const data = (await res.json()) as { razorpayOrder: { keyId: string } };
    expect(data.razorpayOrder.keyId).toBe("rzp_test_public");
    // The response body must NOT carry the Razorpay secret in any shape.
    const raw = JSON.stringify(data);
    expect(raw.toLowerCase()).not.toContain("secret");

    // It forwarded to the booking's payment endpoint with the bearer.
    expect(capturedUrl).toContain(`/v1/bookings/${BOOKING_ID}/payment`);
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ method: "ONLINE", onlinePaise: 200_000, cashPaise: 0 });
  });

  it("rejects an unauthenticated payment before contacting the backend", async () => {
    stub(() => new Response(null, { status: 201 }));
    const res = await POST(payRequest({ method: "ONLINE", onlinePaise: 200_000, cashPaise: 0 }, false), params);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the backend KYC gate (403) — payment is blocked until VERIFIED", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ error: { code: "KYC_REQUIRED", message: "KYC verification is required for this action" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await POST(payRequest({ method: "ONLINE", onlinePaise: 200_000, cashPaise: 0 }), params);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("KYC_REQUIRED");
  });
});
