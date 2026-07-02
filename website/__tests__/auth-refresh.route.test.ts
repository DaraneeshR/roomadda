import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SelfUser } from "@roomadda/shared";
import { POST } from "../app/api/auth/refresh/route";
import { cookieValue, findSetCookie } from "./helpers";

const USER: SelfUser = {
  id: "user_123",
  role: "TENANT",
  phone: "+919812345678",
  fullName: "Asha Rao",
  isPhoneVerified: true,
  createdAt: new Date().toISOString(),
  gender: "FEMALE",
  dateOfBirth: null,
  occupationType: null,
  college: null,
  company: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => vi.unstubAllGlobals());

function refreshRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("POST /api/auth/refresh", () => {
  it("returns 401 without calling the backend when there is no session cookie", async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(refreshRequest());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rotates the refresh cookie and returns a fresh access token (session persists)", async () => {
    fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ accessToken: "access-2", refreshToken: "refresh-2", user: USER }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(refreshRequest("ra_rt=refresh-1"));
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.accessToken).toBe("access-2");
    expect(data).not.toHaveProperty("refreshToken");

    const cookie = findSetCookie(res, "ra_rt");
    expect(cookieValue(cookie as string)).toBe("refresh-2"); // rotated to the successor
    expect((cookie as string).toLowerCase()).toContain("httponly");
  });

  it("clears the cookie and returns 401 when the backend rejects the token", async () => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "REFRESH_EXPIRED", message: "Session expired" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(refreshRequest("ra_rt=stale"));
    expect(res.status).toBe(401);

    const cookie = findSetCookie(res, "ra_rt");
    expect(cookie).toBeTruthy();
    expect((cookie as string).toLowerCase()).toContain("max-age=0"); // cleared
  });
});
