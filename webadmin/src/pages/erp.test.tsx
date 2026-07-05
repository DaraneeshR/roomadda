// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ErpApprovalsPage } from "./ErpApprovalsPage";
import { ErpBookingsPage } from "./ErpBookingsPage";
import { ErpDashboardPage } from "./ErpDashboardPage";

/** Every request the mocked fetch saw, so a test can assert what the UI called. */
interface Call {
  url: string;
  method: string;
  body: unknown;
}

const period = {
  financialYear: 2026,
  label: "FY 2026–27",
  fromInclusive: "2026-04-01T00:00:00.000Z",
  toExclusive: "2027-04-01T00:00:00.000Z",
};

const DASHBOARD = {
  period,
  headline: {
    bookingCount: 12,
    netCommissionPaise: 4500000, // ₹45,000.00
    totalCollectionPaise: 9000000, // ₹90,000.00
    commissionPaise: 5000000,
    paidToPgPaise: 1000000,
    pendingNetPaise: 1500000,
    pendingBookingCount: 4,
    receivedNetPaise: 3000000,
    receivedBookingCount: 8,
    amc: { supported: false, paise: null, note: "AMC model not yet in schema" },
  },
  commissionByProperty: [
    { listingId: "list-1", listingAlias: "Green Nest", bookingCount: 5, commissionPaise: 2500000, netPaise: 2000000 },
  ],
  bookingsByMonth: [
    { month: "2026-04", label: "Apr 2026", bookingCount: 3, commissionPaise: 1000000, netPaise: 800000 },
  ],
  topAgents: [
    { agentId: "agent-1", agentName: "Asha Rao", bookingCount: 6, commissionPaise: 3000000, netPaise: 2500000 },
  ],
  generatedAt: "2026-07-05T00:00:00.000Z",
};

const AGENTS = {
  items: [
    {
      id: "agent-1",
      fullName: "Asha Rao",
      phone: "+919900000001",
      email: null,
      assignedCity: "Pune",
      status: "ACTIVE",
      statusReason: null,
      openVisits: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  nextCursor: null,
};

function ledgerEntry(over: Record<string, unknown> = {}) {
  return {
    bookingId: "bk-1",
    approval: "APPROVED",
    bookingStatus: "CONFIRMED",
    tenantId: "ten-1",
    tenantName: "Ravi Kumar",
    listingId: "list-1",
    listingAlias: "Green Nest",
    agentId: "agent-1",
    agentName: "Asha Rao",
    agentChannel: "ASSISTED",
    monthlyRentPaise: 2000000,
    tokenAmountPaise: 500000,
    depositPaise: 1000000,
    moveInDate: "2026-05-01T00:00:00.000Z",
    confirmedAt: "2026-04-20T00:00:00.000Z",
    createdAt: "2026-04-15T00:00:00.000Z",
    historical: false,
    commission: {
      commissionPaise: 1500000,
      paidToPgPaise: 300000,
      collectedPaise: 2500000,
      netPaise: 1200000,
      status: "PENDING",
    },
    ...over,
  };
}

const LEDGER = {
  items: [ledgerEntry()],
  nextCursor: null,
  totals: {
    bookingCount: 2,
    pendingCount: 1,
    approvedCount: 1,
    rejectedCount: 0,
    cancelledCount: 0,
    commissionedBookingCount: 1,
    commissionPaise: 7777700, // ₹77,777.00 — distinctive, only on the totals card
    collectedPaise: 8888800, // ₹88,888.00
    paidToPgPaise: 1111100, // ₹11,111.00
    netPaise: 3333300, // ₹33,333.00
  },
};

const APPROVALS = {
  items: [ledgerEntry({ bookingId: "bk-pending", approval: "PENDING", bookingStatus: "PENDING_APPROVAL", commission: null })],
  nextCursor: null,
};

function installFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = undefined;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ url: u, method, body });

      const json = (status: number, payload: unknown): Response =>
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

      if (u.includes("/v1/erp/dashboard")) return Promise.resolve(json(200, DASHBOARD));
      if (u.includes("/v1/admin/agents-list")) return Promise.resolve(json(200, AGENTS));
      if (u.includes("/v1/erp/bookings/export")) return Promise.resolve(new Response("id,tenant\n", { status: 200 }));
      if (u.includes("/v1/erp/bookings")) return Promise.resolve(json(200, LEDGER));
      if (u.includes("/v1/erp/approvals/approve")) return Promise.resolve(json(200, { updated: 1, bookingIds: ["bk-pending"] }));
      if (/\/v1\/erp\/approvals\/[^/]+\/approve/.test(u))
        return Promise.resolve(json(200, { decision: { bookingId: "bk-pending", approval: "APPROVED", bookingStatus: "CONFIRMED" } }));
      if (/\/v1\/erp\/approvals\/[^/]+\/reject/.test(u))
        return Promise.resolve(json(200, { decision: { bookingId: "bk-pending", approval: "REJECTED", bookingStatus: "CANCELLED" } }));
      if (u.includes("/v1/erp/approvals")) return Promise.resolve(json(200, APPROVALS));

      return Promise.resolve(json(200, { items: [], nextCursor: null }));
    }),
  );
  return calls;
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ERP dashboard", () => {
  it("renders headline numbers and charts from the /v1/erp/dashboard endpoint", async () => {
    installFetch();
    renderPage(<ErpDashboardPage />);

    expect(await screen.findByText("₹45,000.00")).toBeTruthy(); // net commission headline
    expect(screen.getByText("₹90,000.00")).toBeTruthy(); // total collection headline
    expect(screen.getByText("Green Nest")).toBeTruthy(); // commission-by-property chart
    expect(screen.getByText("Apr 2026")).toBeTruthy(); // bookings-by-month chart
    expect(screen.getByText("Asha Rao")).toBeTruthy(); // top-agents leaderboard
  });

  it("the global filter re-scopes the whole screen (refetch carries the FY param)", async () => {
    const calls = installFetch();
    renderPage(<ErpDashboardPage />);
    await screen.findByText("₹45,000.00");

    // Change the Financial Year filter; the dashboard must refetch scoped to it.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /financial year/i }));
    fireEvent.click(await screen.findByRole("option", { name: /FY 2025/ }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/v1/erp/dashboard") && c.url.includes("financialYear=2025")),
      ).toBe(true),
    );
  });
});

describe("ERP bookings ledger", () => {
  it("renders rows and shows the API's roll-up totals verbatim", async () => {
    installFetch();
    renderPage(<ErpBookingsPage />);

    expect(await screen.findByText("Ravi Kumar")).toBeTruthy(); // a ledger row
    // The totals card mirrors the API totals (distinctive values, engine-sourced).
    expect(screen.getByText("₹77,777.00")).toBeTruthy(); // totals.commissionPaise
    expect(screen.getByText("₹88,888.00")).toBeTruthy(); // totals.collectedPaise
    expect(screen.getByText("₹33,333.00")).toBeTruthy(); // totals.netPaise
  });

  it("exports the current filter via /v1/erp/bookings/export?format=csv", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    // The download anchor's click would make jsdom attempt a navigation; no-op it.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const calls = installFetch();
    renderPage(<ErpBookingsPage />);
    await screen.findByText("Ravi Kumar");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/v1/erp/bookings/export") && c.url.includes("format=csv"))).toBe(true),
    );
  });
});

describe("ERP approvals", () => {
  it("renders the pending queue from /v1/erp/approvals", async () => {
    installFetch();
    renderPage(<ErpApprovalsPage />);
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("bk-pendi")).toBeTruthy(); // shortened id
  });

  it("approve calls the audited single-approve endpoint", async () => {
    const calls = installFetch();
    renderPage(<ErpApprovalsPage />);
    const row = (await screen.findByText("Ravi Kumar")).closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.includes("/v1/erp/approvals/bk-pending/approve")),
      ).toBe(true),
    );
  });

  it("reject posts the reason to the audited reject endpoint", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Incomplete KYC");
    const calls = installFetch();
    renderPage(<ErpApprovalsPage />);
    const row = (await screen.findByText("Ravi Kumar")).closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === "POST" && c.url.includes("/v1/erp/approvals/bk-pending/reject"));
      expect(call).toBeTruthy();
      expect((call?.body as { reason?: string })?.reason).toBe("Incomplete KYC");
    });
  });

  it("bulk approve posts the selected ids to /v1/erp/approvals/approve", async () => {
    const calls = installFetch();
    renderPage(<ErpApprovalsPage />);
    await screen.findByText("Ravi Kumar");

    fireEvent.click(screen.getByRole("button", { name: /select page/i }));
    fireEvent.click(screen.getByRole("button", { name: /approve selected/i }));

    await waitFor(() => {
      const call = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/erp/approvals/approve"));
      expect(call).toBeTruthy();
      expect((call?.body as { bookingIds?: string[] })?.bookingIds).toContain("bk-pending");
    });
  });
});
