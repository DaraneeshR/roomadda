// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";

const ADMIN = {
  id: "1",
  role: "ADMIN",
  phone: "+919900000000",
  fullName: "Admin",
  isPhoneVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockFetch(refreshOk: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/v1/auth/refresh")) {
        return Promise.resolve(
          refreshOk
            ? json(200, { accessToken: "t", user: ADMIN })
            : json(401, { error: { code: "REFRESH_INVALID", message: "no session" } }),
        );
      }
      // Any admin data request -> empty page.
      return Promise.resolve(json(200, { items: [], nextCursor: null }));
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("App auth gate", () => {
  it("redirects an unauthenticated visit to a protected route to the login page", async () => {
    mockFetch(false);
    window.history.pushState({}, "", "/kyc");
    render(<App />);
    // Login page renders (the OTP step).
    expect(await screen.findByText("Send code")).toBeTruthy();
  });

  it("renders the admin app when the cookie refresh restores an ADMIN session", async () => {
    mockFetch(true);
    render(<App />);
    // A nav label that only exists inside the authenticated app shell.
    expect(await screen.findByText("Cash reconciliation")).toBeTruthy();
  });
});
