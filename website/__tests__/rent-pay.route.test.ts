import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/rent/[id]/pay/route";
import { GET } from "../app/api/rent/[id]/route";

const INVOICE_ID = "bbbbbbbb-0000-4000-8000-000000000001";

let capturedInit: RequestInit | undefined;
let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(response: (url: string) => Response): void {
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return response(capturedUrl);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedInit = undefined;
  capturedUrl = undefined;
});
afterEach(() => vi.unstubAllGlobals());

const params = { params: Promise.resolve({ id: INVOICE_ID }) };

function req(path: string, method: string, auth = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: auth ? { authorization: "Bearer access-tok" } : {},
  });
}

describe("POST /api/rent/:id/pay", () => {
  it("forwards a full-amount order and returns the PUBLIC key id (no secret, no client amount)", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            invoiceId: INVOICE_ID,
            amountPaise: 1_200_000,
            razorpayOrder: { orderId: "order_stub_r1", amount: 1_200_000, currency: "INR", keyId: "rzp_test_public" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await POST(req(`/api/rent/${INVOICE_ID}/pay`, "POST"), params);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { amountPaise: number; razorpayOrder: { keyId: string } };
    // The amount is the SERVER's — the client never sent one.
    expect(capturedInit?.body).toBeUndefined();
    expect(data.amountPaise).toBe(1_200_000);
    expect(data.razorpayOrder.keyId).toBe("rzp_test_public");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("secret");
    expect(capturedUrl).toContain(`/v1/rent/${INVOICE_ID}/pay`);
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer access-tok");
  });

  it("rejects an unauthenticated pay before contacting the backend", async () => {
    stub(() => new Response(null, { status: 201 }));
    const res = await POST(req(`/api/rent/${INVOICE_ID}/pay`, "POST", false), params);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/rent/:id (rent poll target) — PAID only when the server says so", () => {
  it("relays a DUE invoice (still unpaid after a callback)", async () => {
    stub(
      () =>
        new Response(JSON.stringify({ invoice: { id: INVOICE_ID, status: "DUE", amountPaise: 1_200_000 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await GET(req(`/api/rent/${INVOICE_ID}`, "GET"), params);
    const { invoice } = (await res.json()) as { invoice: { status: string } };
    expect(invoice.status).toBe("DUE");
  });

  it("relays a PAID invoice once the verified webhook has settled it", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ invoice: { id: INVOICE_ID, status: "PAID", paidAt: "2026-08-03T00:00:00.000Z" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await GET(req(`/api/rent/${INVOICE_ID}`, "GET"), params);
    const { invoice } = (await res.json()) as { invoice: { status: string } };
    expect(invoice.status).toBe("PAID");
  });
});
