import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./apiClient";

const ADMIN_USER = {
  id: "1",
  role: "ADMIN",
  phone: "+919900000000",
  fullName: "Admin",
  isPhoneVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createApiClient — refresh-on-401 interceptor", () => {
  it("refreshes on 401 then retries the original request with the new token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHENTICATED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { accessToken: "newtoken", user: ADMIN_USER }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const onAuthFailure = vi.fn();
    const api = createApiClient("http://api");
    api.setOnAuthFailure(onAuthFailure);

    const result = await api.get<{ ok: boolean }>("/x");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/auth/refresh");
    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect((retryInit.headers as Headers).get("Authorization")).toBe("Bearer newtoken");
    expect(api.getAccessToken()).toBe("newtoken");
  });

  it("calls onAuthFailure and throws ApiError when the refresh also fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHENTICATED", message: "expired" } }))
      .mockResolvedValueOnce(json(401, { error: { code: "REFRESH_INVALID", message: "bad" } }));
    vi.stubGlobal("fetch", fetchMock);

    const onAuthFailure = vi.fn();
    const api = createApiClient("http://api");
    api.setOnAuthFailure(onAuthFailure);

    await expect(api.get("/y")).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(api.getAccessToken()).toBeNull();
  });

  it("dedupes concurrent refreshes (single-flight)", async () => {
    let refreshCount = 0;
    const firstSeen = new Set<string>();
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/v1/auth/refresh")) {
        refreshCount += 1;
        return Promise.resolve(json(200, { accessToken: "t", user: ADMIN_USER }));
      }
      if (!firstSeen.has(u)) {
        firstSeen.add(u);
        return Promise.resolve(json(401, { error: { code: "X", message: "x" } }));
      }
      return Promise.resolve(json(200, { url: u }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApiClient("http://api");
    const [a, b] = await Promise.all([api.get<{ url: string }>("/a"), api.get<{ url: string }>("/b")]);

    expect(refreshCount).toBe(1);
    expect(a.url).toContain("/a");
    expect(b.url).toContain("/b");
  });
});
