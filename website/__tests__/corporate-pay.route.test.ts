import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/corporate/invoices/[id]/pay/route";

/**
 * The company invoice online-payment BFF route. It creates a server-owned Razorpay
 * order and relays it — it NEVER marks the invoice paid (settlement is the verified
 * webhook's job alone). The relayed order carries only the PUBLIC keyId, never a
 * secret; a foreign invoice is a 404 (scoping) passed straight through.
 */

const INVOICE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
let capturedUrl: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function stub(status: number, body: unknown): void {
  fetchMock = vi.fn(async (url: string | URL) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  capturedUrl = undefined;
});
afterEach(() => vi.unstubAllGlobals());

function payReq(auth = true): NextRequest {
  return new NextRequest(`http://localhost/api/corporate/invoices/${INVOICE_ID}/pay`, {
    method: "POST",
    headers: auth ? { authorization: "Bearer access-tok" } : {},
  });
}
const params = { params: Promise.resolve({ id: INVOICE_ID }) };

describe("POST /api/corporate/invoices/:id/pay", () => {
  it("relays the server-owned order with a PUBLIC keyId and no secret", async () => {
    stub(201, {
      invoiceId: INVOICE_ID,
      amountPaise: 1_050_000,
      razorpayOrder: { orderId: "order_stub_1", amount: 1_050_000, currency: "INR", keyId: "rzp_test_public" },
    });

    const res = await POST(payReq(), params);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { razorpayOrder: { keyId: string } };
    expect(data.razorpayOrder.keyId).toBe("rzp_test_public");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("secret");
    expect(capturedUrl).toContain(`/v1/corporate/invoices/${INVOICE_ID}/pay`);
  });

  it("rejects an unauthenticated caller before contacting the backend", async () => {
    stub(201, {});
    const res = await POST(payReq(false), params);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a scoping 404 straight through (a foreign invoice is not found)", async () => {
    stub(404, { error: { code: "CORPORATE_INVOICE_NOT_FOUND", message: "Corporate invoice not found" } });
    const res = await POST(payReq(), params);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("CORPORATE_INVOICE_NOT_FOUND");
  });
});
