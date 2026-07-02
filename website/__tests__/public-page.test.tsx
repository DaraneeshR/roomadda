import { describe, expect, it, vi } from "vitest";

// The home page fetches only PUBLIC (masked) data. Mock that layer so the test
// stays offline and can assert the page needs no session to render.
vi.mock("../lib/api", () => ({
  publicApi: {
    featured: vi.fn(async () => ({ items: [] })),
    listings: vi.fn(),
    listing: vi.fn(),
    nearby: vi.fn(),
  },
}));

import HomePage from "../app/page";
import { publicApi } from "../lib/api";

describe("public discovery", () => {
  it("renders for anonymous visitors without any auth", async () => {
    // No cookie, no token, no session — discovery is open.
    const element = await HomePage();
    expect(element).toBeTruthy();
    // It served public listings; it never reached for an authenticated endpoint.
    expect(publicApi.featured).toHaveBeenCalled();
  });
});
