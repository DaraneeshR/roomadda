import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/kyc/upload/route";

const PRESIGNED_KEY = "kyc/user_123/aadhaar_front-abc123.jpg"; // private, per-user prefix
const PRESIGNED_URL = "https://kyc-uploads.stub.local/kyc/user_123/aadhaar_front-abc123.jpg?stub=1";

let presignInit: RequestInit | undefined;
let putUrl: string | undefined;
let putInit: RequestInit | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  presignInit = undefined;
  putUrl = undefined;
  putInit = undefined;
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    const u = String(url);
    if (u.includes("/v1/kyc/upload-url")) {
      presignInit = init;
      return new Response(
        JSON.stringify({ key: PRESIGNED_KEY, uploadUrl: PRESIGNED_URL, expiresInSeconds: 900 }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (u === PRESIGNED_URL) {
      putUrl = u;
      putInit = init;
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function uploadRequest(): NextRequest {
  const form = new FormData();
  form.set("slot", "aadhaar_front");
  form.set("file", new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/jpeg" }), "front.jpg");
  return new NextRequest("http://localhost/api/kyc/upload", {
    method: "POST",
    headers: { authorization: "Bearer access-tok" },
    body: form,
  });
}

describe("POST /api/kyc/upload", () => {
  it("uses the backend's presigned-URL path and stores to the private bucket", async () => {
    const res = await POST(uploadRequest());

    expect(res.status).toBe(201);
    const data = (await res.json()) as { key: string; slot: string };
    expect(data).toEqual({ key: PRESIGNED_KEY, slot: "aadhaar_front" });
    // Key lives under the caller's private KYC prefix.
    expect(data.key.startsWith("kyc/")).toBe(true);

    // 1) It asked the PRIVATE presign endpoint, forwarding the access token.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/kyc/upload-url");
    expect(JSON.parse(String(presignInit?.body))).toEqual({
      slot: "aadhaar_front",
      contentType: "image/jpeg",
    });
    expect(new Headers(presignInit?.headers).get("authorization")).toBe("Bearer access-tok");

    // 2) It PUT the bytes to the presigned bucket URL with the pinned SSE +
    //    ContentType headers (encrypted, private object) — never a public URL.
    expect(putUrl).toBe(PRESIGNED_URL);
    expect(putInit?.method).toBe("PUT");
    const putHeaders = new Headers(putInit?.headers);
    expect(putHeaders.get("content-type")).toBe("image/jpeg");
    expect(putHeaders.get("x-amz-server-side-encryption")).toBe("AES256");
  });

  it("rejects an unauthenticated upload before contacting the backend", async () => {
    const form = new FormData();
    form.set("slot", "aadhaar_front");
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/jpeg" }), "f.jpg");
    const res = await POST(
      new NextRequest("http://localhost/api/kyc/upload", { method: "POST", body: form }),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type", async () => {
    const form = new FormData();
    form.set("slot", "aadhaar_front");
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/gif" }), "f.gif");
    const res = await POST(
      new NextRequest("http://localhost/api/kyc/upload", {
        method: "POST",
        headers: { authorization: "Bearer access-tok" },
        body: form,
      }),
    );
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
