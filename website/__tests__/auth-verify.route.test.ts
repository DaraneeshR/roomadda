import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SelfUser } from "@roomadda/shared";
import { POST } from "../app/api/auth/otp/verify/route";
import { cookieValue, findSetCookie } from "./helpers";

/** An account that already exists (created earlier from the mobile app). */
const EXISTING_APP_USER: SelfUser = {
  id: "user_123",
  role: "TENANT",
  phone: "+919812345678",
  fullName: "Asha Rao", // already onboarded → no profile step
  isPhoneVerified: true,
  createdAt: new Date().toISOString(),
  gender: "FEMALE",
  dateOfBirth: null,
  occupationType: null,
  college: null,
  company: null,
};

let capturedBody: Record<string, unknown> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  capturedBody = undefined;
  fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
    if (String(url).includes("/v1/auth/otp/verify")) {
      capturedBody = JSON.parse(String(init.body));
      // The backend upserts by phone and returns the EXISTING account.
      return new Response(
        JSON.stringify({
          accessToken: "access-tok",
          refreshToken: "refresh-tok",
          user: EXISTING_APP_USER,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function verifyRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp/verify", () => {
  it("reuses the SAME phone-keyed account — no duplicate, no parallel identity", async () => {
    const res = await POST(verifyRequest({ phone: "+919812345678", code: "123456" }));

    expect(res.status).toBe(200);
    // It forwards the phone straight to the app's OTP verify and relies on the
    // backend's upsert-by-phone; it never invents a second identity field.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/auth/otp/verify");
    expect(capturedBody).toEqual({ phone: "+919812345678", code: "123456", client: "mobile" });

    const data = (await res.json()) as { user: SelfUser; needsProfile: boolean };
    expect(data.user.id).toBe("user_123"); // the same account the app created
    expect(data.user.phone).toBe("+919812345678");
    expect(data.needsProfile).toBe(false);
  });

  it("puts the access token in the body and the refresh token in an httpOnly cookie only", async () => {
    const res = await POST(verifyRequest({ phone: "+919812345678", code: "123456" }));

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.accessToken).toBe("access-tok"); // → held in memory by the client
    expect(data).not.toHaveProperty("refreshToken"); // never reaches JS → never localStorage

    const cookie = findSetCookie(res, "ra_rt");
    expect(cookie).toBeTruthy();
    expect(cookieValue(cookie as string)).toBe("refresh-tok");
    expect((cookie as string).toLowerCase()).toContain("httponly");
    expect((cookie as string).toLowerCase()).toContain("samesite=strict");
    // (Secure is env-gated: on in production, relaxed for local http — same as the backend.)
  });

  it("rejects a malformed request before touching the backend", async () => {
    const res = await POST(verifyRequest({ phone: "not-a-phone", code: "12" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
