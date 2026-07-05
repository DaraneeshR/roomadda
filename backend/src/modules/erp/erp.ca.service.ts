/**
 * ERP-5 CA & Compliance (§15.3). One click builds a true multi-sheet `.xlsx`
 * compliance pack scoped to a financial year, and the same six report definitions
 * back the individual report exports (xlsx or csv). EVERY figure is engine-sourced:
 * all six sheets roll up the SAME engine-priced confirmed-paid set the §15.3
 * dashboard uses ({@link gatherConfirmedPaidBookings}) for the same FY, so each
 * money sheet's totals reconcile to the dashboard headline (the "summary" sheet IS
 * that headline). Nothing here recomputes money — it only formats engine amounts.
 * ADMIN-only (route-enforced).
 */
import {
  computeInvoiceBreakdown,
  financialYearOf,
  resolveFinancialPeriod,
  type FinancialPeriod,
} from "./erp.engine.js";
import { gatherConfirmedPaidBookings, type FinanceBooking } from "./erp.finance.js";
import { erpFinanceService } from "./erp.finance.service.js";
import { erpSettingsService } from "./erp.settings.service.js";
import { buildWorkbook, sheetToCsv, type Sheet } from "./erp.xlsx.js";
import type { ErpDashboardResponse, ErpReportKind } from "@roomadda/shared";

/** The resolved compliance scope: the FY and its period, plus a human label. */
interface CaScope {
  financialYear: number;
  label: string;
  period: FinancialPeriod;
}

export const erpCaService = {
  /**
   * The one-click CA pack: a real `.xlsx` workbook with all six FY-scoped sheets.
   * Returns the bytes plus the resolved FY (for the filename / response headers).
   */
  async caPack(query: { financialYear?: number }, now: Date = new Date()): Promise<{ buffer: Buffer; financialYear: number; label: string }> {
    const scope = await resolveScope(query, now);
    const { bookings, dashboard } = await gather(scope);
    const sheets = ALL_REPORTS.map((kind) => buildSheet(kind, bookings, dashboard, scope));
    const buffer = await buildWorkbook(sheets);
    return { buffer, financialYear: scope.financialYear, label: scope.label };
  },

  /** One report export as xlsx (a single-sheet workbook) or csv, FY-scoped. */
  async report(
    kind: ErpReportKind,
    query: { financialYear?: number; format: "xlsx" | "csv" },
    now: Date = new Date(),
  ): Promise<{ body: Buffer | string; contentType: string; filename: string; financialYear: number }> {
    const scope = await resolveScope(query, now);
    const { bookings, dashboard } = await gather(scope);
    const sheet = buildSheet(kind, bookings, dashboard, scope);
    const stamp = `FY${scope.financialYear}`;
    if (query.format === "csv") {
      return {
        body: sheetToCsv(sheet),
        contentType: "text/csv; charset=utf-8",
        filename: `roomadda-${kind}-${stamp}.csv`,
        financialYear: scope.financialYear,
      };
    }
    return {
      body: await buildWorkbook([sheet]),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `roomadda-${kind}-${stamp}.xlsx`,
      financialYear: scope.financialYear,
    };
  },
};

/** The six standard reports (also the CA pack's six sheets, in this order). */
const ALL_REPORTS: ErpReportKind[] = [
  "bookings-ledger",
  "commission-ledger",
  "customer-invoices",
  "commission-invoices",
  "collections-settlements",
  "summary",
];

// ---------------------------------------------------------------------------
// Scope resolution + data gathering.
// ---------------------------------------------------------------------------

/** Resolve the FY: explicit query wins, else the active FY from settings, else now. */
async function resolveScope(query: { financialYear?: number }, now: Date): Promise<CaScope> {
  const fy = query.financialYear ?? (await erpSettingsService.activeFinancialYear(financialYearOf(now)));
  const period = resolveFinancialPeriod({ financialYear: fy }, now);
  return { financialYear: fy, label: period.label, period };
}

async function gather(scope: CaScope): Promise<{ bookings: FinanceBooking[]; dashboard: ErpDashboardResponse }> {
  // Whole company for the FY (no property/agent scope) — the pack covers everything.
  const [bookings, dashboard] = await Promise.all([
    gatherConfirmedPaidBookings({}, scope.period),
    erpFinanceService.dashboard({ financialYear: scope.financialYear }),
  ]);
  return { bookings, dashboard };
}

// ---------------------------------------------------------------------------
// Sheet builders — pure formatting of the engine-priced set. One per report.
// ---------------------------------------------------------------------------

const dateOnly = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "");

function buildSheet(kind: ErpReportKind, bookings: FinanceBooking[], dashboard: ErpDashboardResponse, scope: CaScope): Sheet {
  switch (kind) {
    case "bookings-ledger":
      return bookingsLedgerSheet(bookings);
    case "commission-ledger":
      return commissionLedgerSheet(bookings);
    case "customer-invoices":
      return customerInvoicesSheet(bookings);
    case "commission-invoices":
      return commissionInvoicesSheet(bookings);
    case "collections-settlements":
      return collectionsSettlementsSheet(bookings);
    case "summary":
      return summarySheet(dashboard, scope);
  }
}

function bookingsLedgerSheet(bookings: FinanceBooking[]): Sheet {
  let rent = 0, commission = 0, collected = 0, net = 0;
  const rows = bookings.map((b) => {
    rent += b.monthlyRentPaise;
    commission += b.money.commissionPaise;
    collected += b.money.collectedPaise;
    net += b.money.netPaise;
    return [
      b.id,
      dateOnly(b.confirmedAt),
      b.tenantName,
      b.listingAlias,
      b.agentName ?? "",
      b.agentChannel ?? "",
      b.monthlyRentPaise,
      b.money.commissionPaise,
      b.money.collectedPaise,
      b.money.netPaise,
      b.money.settlementStatus,
    ];
  });
  return {
    name: "Bookings Ledger",
    columns: [
      { header: "Booking ID", kind: "text" },
      { header: "Confirmed", kind: "date" },
      { header: "Tenant", kind: "text" },
      { header: "Listing", kind: "text" },
      { header: "Agent", kind: "text" },
      { header: "Channel", kind: "text" },
      { header: "Monthly Rent (INR)", kind: "rupees" },
      { header: "Commission (INR)", kind: "rupees" },
      { header: "Collected (INR)", kind: "rupees" },
      { header: "Net Commission (INR)", kind: "rupees" },
      { header: "Settlement", kind: "text" },
    ],
    rows,
    totalsRow: ["TOTAL", "", "", "", "", "", rent, commission, collected, net, ""],
  };
}

function commissionLedgerSheet(bookings: FinanceBooking[]): Sheet {
  let commission = 0, paidToPg = 0, collected = 0, net = 0;
  const rows = bookings.map((b) => {
    commission += b.money.commissionPaise;
    paidToPg += b.money.paidToPgPaise;
    collected += b.money.collectedPaise;
    net += b.money.netPaise;
    return [
      b.id,
      dateOnly(b.confirmedAt),
      b.listingAlias,
      b.agentName ?? "",
      b.money.commissionPaise,
      b.money.paidToPgPaise,
      b.money.collectedPaise,
      b.money.netPaise,
      b.money.settlementStatus,
    ];
  });
  return {
    name: "Commission Ledger",
    columns: [
      { header: "Booking ID", kind: "text" },
      { header: "Confirmed", kind: "date" },
      { header: "Listing", kind: "text" },
      { header: "Agent", kind: "text" },
      { header: "Commission (INR)", kind: "rupees" },
      { header: "Paid to PG (INR)", kind: "rupees" },
      { header: "Collected (INR)", kind: "rupees" },
      { header: "Net (INR)", kind: "rupees" },
      { header: "Settlement", kind: "text" },
    ],
    rows,
    totalsRow: ["TOTAL", "", "", "", commission, paidToPg, collected, net, ""],
  };
}

function customerInvoicesSheet(bookings: FinanceBooking[]): Sheet {
  let deposit = 0, proRata = 0, moveInTotal = 0, collected = 0, balance = 0;
  const rows = bookings.map((b) => {
    const bd = computeInvoiceBreakdown({
      monthlyRentPaise: b.monthlyRentPaise,
      depositPaise: b.depositPaise,
      tokenAmountPaise: b.tokenAmountPaise,
      moveIn: b.moveInDate,
    });
    const pr = bd.proRataFirstMonthRentPaise ?? 0;
    const mit = bd.moveInTotalPaise ?? bd.depositPaise; // no move-in → deposit only
    const bal = mit - b.money.collectedPaise;
    deposit += bd.depositPaise;
    proRata += pr;
    moveInTotal += mit;
    collected += b.money.collectedPaise;
    balance += bal;
    return [b.id, b.tenantName, b.listingAlias, bd.depositPaise, pr, mit, b.money.collectedPaise, bal];
  });
  return {
    name: "Customer Invoices",
    columns: [
      { header: "Booking ID", kind: "text" },
      { header: "Tenant", kind: "text" },
      { header: "Listing", kind: "text" },
      { header: "Deposit (INR)", kind: "rupees" },
      { header: "Pro-rata First Month (INR)", kind: "rupees" },
      { header: "Move-in Total (INR)", kind: "rupees" },
      { header: "Collected (INR)", kind: "rupees" },
      { header: "Balance Due (INR)", kind: "rupees" },
    ],
    rows,
    totalsRow: ["TOTAL", "", "", deposit, proRata, moveInTotal, collected, balance],
  };
}

function commissionInvoicesSheet(bookings: FinanceBooking[]): Sheet {
  let commission = 0, paidToPg = 0, collected = 0, net = 0;
  const rows = bookings.map((b) => {
    commission += b.money.commissionPaise;
    paidToPg += b.money.paidToPgPaise;
    collected += b.money.collectedPaise;
    net += b.money.netPaise;
    const direction = b.money.netPaise > 0 ? "PG owes RoomAdda" : b.money.netPaise < 0 ? "RoomAdda owes PG" : "Settled even";
    return [
      b.id,
      b.listingAlias,
      b.money.commissionPaise,
      b.money.paidToPgPaise,
      b.money.collectedPaise,
      b.money.netPaise,
      direction,
      b.money.settlementStatus,
    ];
  });
  return {
    name: "Commission Invoices",
    columns: [
      { header: "Booking ID", kind: "text" },
      { header: "Listing (PG)", kind: "text" },
      { header: "Commission (INR)", kind: "rupees" },
      { header: "Paid to PG (INR)", kind: "rupees" },
      { header: "Collected (INR)", kind: "rupees" },
      { header: "Net Position (INR)", kind: "rupees" },
      { header: "Direction", kind: "text" },
      { header: "Settlement", kind: "text" },
    ],
    rows,
    totalsRow: ["TOTAL", "", commission, paidToPg, collected, net, "", ""],
  };
}

function collectionsSettlementsSheet(bookings: FinanceBooking[]): Sheet {
  let collected = 0, paidToPg = 0, net = 0;
  const rows = bookings.map((b) => {
    collected += b.money.collectedPaise;
    paidToPg += b.money.paidToPgPaise;
    net += b.money.netPaise;
    return [
      b.id,
      dateOnly(b.confirmedAt),
      b.listingAlias,
      b.money.collectedPaise,
      b.money.paidToPgPaise,
      b.money.netPaise,
      b.money.settlementStatus,
      dateOnly(b.money.receivedAt),
    ];
  });
  return {
    name: "Collections & Settlements",
    columns: [
      { header: "Booking ID", kind: "text" },
      { header: "Confirmed", kind: "date" },
      { header: "Listing", kind: "text" },
      { header: "Collected (INR)", kind: "rupees" },
      { header: "Paid to PG (INR)", kind: "rupees" },
      { header: "Net (INR)", kind: "rupees" },
      { header: "Settlement", kind: "text" },
      { header: "Received At", kind: "date" },
    ],
    rows,
    totalsRow: ["TOTAL", "", "", collected, paidToPg, net, "", ""],
  };
}

/** The reconciliation anchor: the §15.3 dashboard headline for the FY, verbatim. */
function summarySheet(dashboard: ErpDashboardResponse, scope: CaScope): Sheet {
  const h = dashboard.headline;
  const money = (label: string, paise: number): [string, number | null, number | null] => [label, paise, null];
  const count = (label: string, n: number): [string, number | null, number | null] => [label, null, n];
  const rows: (string | number | null)[][] = [
    [`Financial Year`, null, scope.financialYear],
    money("Net commission", h.netCommissionPaise),
    money("Total collection", h.totalCollectionPaise),
    money("Gross commission", h.commissionPaise),
    money("Paid to PG owners", h.paidToPgPaise),
    money("Pending net", h.pendingNetPaise),
    money("Received net", h.receivedNetPaise),
    count("Bookings (confirmed-paid)", h.bookingCount),
    count("Bookings pending settlement", h.pendingBookingCount),
    count("Bookings settled", h.receivedBookingCount),
    ["AMC (Annual Maintenance Contract)", null, null], // flagged gap — not modelled, never fabricated
  ];
  return {
    name: "Summary",
    columns: [
      { header: "Metric", kind: "text" },
      { header: "Amount (INR)", kind: "rupees" },
      { header: "Count", kind: "int" },
    ],
    rows,
  };
}
