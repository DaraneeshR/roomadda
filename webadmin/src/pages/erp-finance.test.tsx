// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { InvoiceReviewDialog } from "../components/erp/InvoiceReviewDialog";
import { ErpAgentsFinancePage } from "./ErpAgentsFinancePage";
import { ErpCaPage } from "./ErpCaPage";
import { ErpInvoicesPage } from "./ErpInvoicesPage";
import { ErpMoneyManagerPage } from "./ErpMoneyManagerPage";
import { ErpSettingsPage } from "./ErpSettingsPage";

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
    bookingCount: 1,
    netCommissionPaise: 0,
    totalCollectionPaise: 0,
    commissionPaise: 0,
    paidToPgPaise: 0,
    pendingNetPaise: 0,
    pendingBookingCount: 0,
    receivedNetPaise: 0,
    receivedBookingCount: 0,
    amc: { supported: false, paise: null, note: "n/a" },
  },
  commissionByProperty: [{ listingId: "list-1", listingAlias: "Green Nest", bookingCount: 1, commissionPaise: 0, netPaise: 0 }],
  bookingsByMonth: [],
  topAgents: [],
  generatedAt: "2026-07-05T00:00:00.000Z",
};

const AGENTS_LIST = {
  items: [
    { id: "agent-1", fullName: "Asha Rao", phone: "+91990000001", email: null, assignedCity: "Pune", status: "ACTIVE", statusReason: null, openVisits: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "agent-2", fullName: "Vik Singh", phone: "+91990000002", email: null, assignedCity: "Pune", status: "ACTIVE", statusReason: null, openVisits: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  nextCursor: null,
};

const CUSTOMER_INVOICE = {
  bookingId: "bk-1",
  type: "CUSTOMER",
  recipient: { name: "Ravi Kumar", phone: "+919900000009" },
  listingAlias: "Green Nest",
  lineItems: [
    { code: "DEPOSIT", label: "Security deposit", amountPaise: 1000000, source: "ENGINE" },
    { code: "PRO_RATA_RENT", label: "First month rent (pro-rata)", amountPaise: 800000, source: "ENGINE" },
    { code: "MAINTENANCE", label: "Maintenance", amountPaise: 0, source: "MANUAL" },
    { code: "ELECTRICITY", label: "Electricity", amountPaise: 0, source: "MANUAL" },
  ],
  totalPaise: 1800000,
  paidPaise: 500000,
  balancePaise: 1300000,
  status: "DRAFT",
  sentAt: null,
};

// After adding ₹2,000 maintenance the server recomputes the total/balance.
const CUSTOMER_INVOICE_UPDATED = {
  ...CUSTOMER_INVOICE,
  lineItems: CUSTOMER_INVOICE.lineItems.map((l) => (l.code === "MAINTENANCE" ? { ...l, amountPaise: 200000 } : l)),
  totalPaise: 2000000,
  balancePaise: 1500000, // ₹15,000.00 — distinctive proof of the recompute
};

const INVOICE_LIST = {
  items: [
    { bookingId: "bk-1", type: "CUSTOMER", recipientName: "Ravi Kumar", recipientPhone: "+919900000009", listingAlias: "Green Nest", totalPaise: 1800000, balancePaise: 1300000, status: "DRAFT", sentAt: null },
  ],
  nextCursor: null,
};

const MONEY = {
  period,
  months: [
    { month: "2026-04", label: "Apr 2026", bookingCount: 3, collectionPaise: 5000000, commissionPaise: 1000000, payoutPaise: 200000, netPaise: 800000, settledNetPaise: 500000, pendingNetPaise: 300000, runningBalancePaise: 800000 },
  ],
  totals: { bookingCount: 3, collectionPaise: 5000000, commissionPaise: 1000000, payoutPaise: 200000, netPaise: 800000, settledNetPaise: 500000, pendingNetPaise: 300000 },
  customers: [{ tenantId: "ten-1", tenantName: "Ravi Kumar", bookingCount: 2, collectionPaise: 4000000, commissionPaise: 800000, netPaise: 600000 }],
  generatedAt: "2026-07-05T00:00:00.000Z",
};

const scorecard = {
  agentId: "agent-1",
  agentName: "Asha Rao",
  assignedCity: "Pune",
  submitted: 10,
  approved: 6,
  conversionRate: 0.6,
  collectionPaise: 5000000,
  commissionPaise: 3000000,
  netPaise: 2500000,
  tier: { name: "Silver", minBookings: 5, nextTierName: "Gold", bookingsToNextTier: 4 },
};
const AGENTS_FINANCE = { period, agents: [scorecard], leaderboard: [scorecard], generatedAt: "2026-07-05T00:00:00.000Z" };

const REASSIGN_RESULT = {
  result: {
    bookingId: "bk-xyz",
    previousAgentId: "agent-1",
    agentId: "agent-2",
    agentName: "Vik Singh",
    commission: { commissionPaise: 1500000, paidToPgPaise: 0, collectedPaise: 2000000, netPaise: 1500000, status: "PENDING" },
  },
};

const SETTINGS = {
  settings: {
    legalName: "RoomAdda Pvt Ltd",
    displayName: "RoomAdda",
    gstin: null,
    pan: null,
    addressLine: null,
    city: null,
    state: null,
    pincode: null,
    contactEmail: null,
    contactPhone: null,
    financialYear: 2026,
    operatingModes: { onlineBookingsEnabled: true, walkInBookingsEnabled: true, maintenanceMode: false },
    availableRoles: ["ADMIN"],
    updatedAt: "2026-07-05T00:00:00.000Z",
  },
};

const TEAM = {
  items: [
    { id: "u-1", fullName: "Ops Admin", email: "ops@roomadda.in", role: "ADMIN", status: "ACTIVE", mustChangePassword: true, createdAt: "2026-02-01T00:00:00.000Z" },
  ],
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

      const json = (payload: unknown, status = 200): Response =>
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

      // Filter-option sources.
      if (u.includes("/v1/admin/agents-list")) return Promise.resolve(json(AGENTS_LIST));
      if (u.includes("/v1/erp/dashboard")) return Promise.resolve(json(DASHBOARD));

      // Invoices — specific-invoice ops (id segment) vs the list.
      if (/\/v1\/erp\/invoices\/[^/?]+/.test(u)) {
        if (method === "PATCH") return Promise.resolve(json({ invoice: CUSTOMER_INVOICE_UPDATED }));
        return Promise.resolve(json({ invoice: CUSTOMER_INVOICE }));
      }
      if (u.includes("/v1/erp/invoices")) return Promise.resolve(json(INVOICE_LIST));

      if (u.includes("/v1/erp/money-manager")) return Promise.resolve(json(MONEY));
      if (/\/v1\/erp\/agents\/bookings\/[^/]+\/reassign/.test(u)) return Promise.resolve(json(REASSIGN_RESULT));
      if (u.includes("/v1/erp/agents")) return Promise.resolve(json(AGENTS_FINANCE));

      if (u.includes("/v1/erp/ca-pack"))
        return Promise.resolve(new Response("PK\x03\x04", { status: 200, headers: { "Content-Type": XLSX_MIME } }));

      if (u.includes("/v1/erp/settings")) return Promise.resolve(json(SETTINGS));
      if (u.includes("/v1/erp/team")) {
        if (method === "POST") return Promise.resolve(json({ member: { ...TEAM.items[0], id: "u-2" } }, 201));
        return Promise.resolve(json(TEAM));
      }

      return Promise.resolve(json({ items: [], nextCursor: null }));
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

describe("Invoice Center", () => {
  it("renders invoice rows from /v1/erp/invoices", async () => {
    installFetch();
    renderPage(<ErpInvoicesPage />);
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("Green Nest")).toBeTruthy();
  });

  it("an engine line renders NO input; editing a manual line recomputes the balance server-side", async () => {
    const calls = installFetch();
    renderPage(<InvoiceReviewDialog bookingId="bk-1" type="CUSTOMER" onClose={() => {}} />);

    // Wait for the invoice to load.
    await screen.findByText("Security deposit");

    // Engine lines (deposit, pro-rata) are display-only — no input field.
    expect(screen.getByTestId("invoice-line-DEPOSIT").querySelector("input")).toBeNull();
    expect(screen.getByTestId("invoice-line-PRO_RATA_RENT").querySelector("input")).toBeNull();
    // Manual lines are editable.
    const maintInput = screen.getByTestId("invoice-line-MAINTENANCE").querySelector("input");
    expect(maintInput).not.toBeNull();

    // Edit maintenance to ₹2,000 and save → server returns the recomputed balance.
    fireEvent.change(maintInput as HTMLInputElement, { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: /save & recompute balance/i }));

    // The PATCH carried the manual figure (paise), not an engine figure.
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/v1/erp/invoices/bk-1"));
      expect(patch).toBeTruthy();
      expect((patch?.body as { maintenancePaise?: number })?.maintenancePaise).toBe(200000);
    });
    // The recomputed balance (₹15,000.00) is now shown.
    expect(await screen.findByText("₹15,000.00")).toBeTruthy();
  });
});

describe("Money Manager", () => {
  it("renders month rows, totals, and the customer drill-down", async () => {
    installFetch();
    renderPage(<ErpMoneyManagerPage />);
    // "Apr 2026" appears in both the month table and the collection chart.
    expect((await screen.findAllByText("Apr 2026")).length).toBeGreaterThan(0);
    expect(screen.getByText("Ravi Kumar")).toBeTruthy(); // customer drill-down
    expect(screen.getAllByText("₹50,000.00").length).toBeGreaterThan(0); // collection month + total
  });
});

describe("Agents (finance)", () => {
  it("renders the leaderboard from /v1/erp/agents", async () => {
    installFetch();
    renderPage(<ErpAgentsFinancePage />);
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy(); // conversion rate
  });

  it("reassigning a booking calls the audited reassign endpoint with the new agent", async () => {
    const calls = installFetch();
    renderPage(<ErpAgentsFinancePage />);
    await screen.findByText("Asha Rao");

    fireEvent.click(screen.getByRole("button", { name: /reassign booking/i }));
    fireEvent.change(await screen.findByLabelText("Booking ID"), { target: { value: "bk-xyz" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /new agent/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Vik Singh" }));
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));

    await waitFor(() => {
      const call = calls.find((c) => c.method === "POST" && c.url.includes("/v1/erp/agents/bookings/bk-xyz/reassign"));
      expect(call).toBeTruthy();
      expect((call?.body as { agentId?: string })?.agentId).toBe("agent-2");
    });
  });
});

describe("CA & Compliance", () => {
  it("downloads a valid .xlsx CA pack via the authed blob path", async () => {
    let captured: Blob | null = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        captured = b;
        return "blob:x";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const calls = installFetch();
    renderPage(<ErpCaPage />);

    fireEvent.click(screen.getByRole("button", { name: /download ca pack/i }));

    await waitFor(() => expect(calls.some((c) => c.url.includes("/v1/erp/ca-pack"))).toBe(true));
    await waitFor(() => expect(captured).not.toBeNull());
    expect((captured as unknown as Blob).type).toBe(XLSX_MIME);
  });
});

describe("Settings", () => {
  it("renders company details and the team roster", async () => {
    installFetch();
    renderPage(<ErpSettingsPage />);
    expect(await screen.findByText("Company details")).toBeTruthy();
    expect(await screen.findByText("Ops Admin")).toBeTruthy();
  });

  it("adding a team login calls the audited /v1/erp/team endpoint", async () => {
    const calls = installFetch();
    renderPage(<ErpSettingsPage />);
    await screen.findByText("Team logins");

    fireEvent.click(screen.getByRole("button", { name: /add team login/i }));
    fireEvent.change(await screen.findByLabelText("Full name"), { target: { value: "New Admin" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@roomadda.in" } });
    fireEvent.change(screen.getByLabelText(/temp password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create login/i }));

    await waitFor(() => {
      const call = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/erp/team"));
      expect(call).toBeTruthy();
      const b = call?.body as { fullName?: string; email?: string; tempPassword?: string; role?: string };
      expect(b?.fullName).toBe("New Admin");
      expect(b?.email).toBe("new@roomadda.in");
      expect(b?.tempPassword).toBe("supersecret");
      expect(b?.role).toBe("ADMIN");
    });
  });
});
