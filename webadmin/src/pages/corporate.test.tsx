// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { CorporateCompaniesPage } from "./CorporateCompaniesPage";
import { CorporateFinancePage } from "./CorporateFinancePage";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const COMPANIES = {
  items: [
    { id: "co-1", name: "Acme Corp", gstin: "29AAAAA0000A1Z5", billingAddress: null, billingEmail: null, status: "ACTIVE", accountManagerId: null, billingMode: "CREDIT", creditDays: 30, createdAt: "2027-01-01T00:00:00.000Z" },
  ],
  nextCursor: null,
};

const FINANCE = {
  summary: { invoicedPaise: 7654300, collectedPaise: 5000000, outstandingPaise: 2654300, overdueCount: 1 },
};

const INVOICES = {
  items: [
    { id: "inv-1", companyId: "co-1", corporateBookingId: "bk-1", billingMode: "CREDIT", status: "DUE", totalPaise: 2654300, paidPaise: 0, balancePaise: 2654300, issuedAt: "2027-02-01T00:00:00.000Z", dueDate: "2027-03-03T00:00:00.000Z", paidAt: null, createdAt: "2027-02-01T00:00:00.000Z" },
  ],
  nextCursor: null,
};

function installFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
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

      if (u.includes("/v1/corporate/admin/companies")) return Promise.resolve(json(200, COMPANIES));
      if (u.includes("/v1/corporate/admin/finance")) return Promise.resolve(json(200, FINANCE));
      if (/\/v1\/corporate\/admin\/invoices\/[^/]+\/settle-offline/.test(u))
        return Promise.resolve(json(200, { invoice: { ...INVOICES.items[0], status: "PAID", paidPaise: 2654300, balancePaise: 0 } }));
      if (u.includes("/v1/corporate/admin/invoices")) return Promise.resolve(json(200, INVOICES));
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

describe("Corporate companies", () => {
  it("renders the company directory from the real admin endpoint", async () => {
    installFetch();
    renderPage(<CorporateCompaniesPage />);
    expect(await screen.findByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("29AAAAA0000A1Z5")).toBeTruthy();
  });
});

describe("Corporate finance", () => {
  it("renders the engine-sourced receivables roll-up + invoice rows", async () => {
    installFetch();
    renderPage(<CorporateFinancePage />);
    // Summary card figures come straight from /v1/corporate/admin/finance.
    expect(await screen.findByText("₹76,543.00")).toBeTruthy(); // invoiced
    expect(screen.getByText("₹50,000.00")).toBeTruthy(); // collected
    // Invoice row (engine-sourced total).
    expect(screen.getAllByText("₹26,543.00").length).toBeGreaterThan(0);
  });

  it("settles an invoice OFFLINE via the audited settle-offline endpoint", async () => {
    const calls = installFetch();
    vi.spyOn(window, "prompt").mockReturnValue("NEFT-REF-9");
    renderPage(<CorporateFinancePage />);
    await screen.findByText("₹76,543.00");

    fireEvent.click(screen.getByRole("button", { name: /settle offline/i }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url.includes("/v1/corporate/admin/invoices/inv-1/settle-offline") && (c.body as { settlementRef?: string }).settlementRef === "NEFT-REF-9",
        ),
      ).toBe(true),
    );
  });
});
