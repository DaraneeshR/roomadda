import type {
  AddTeamMemberInput,
  BookingApprovalDecision,
  BookingApprovalsResponse,
  BookingBulkApproveResult,
  BookingLedgerEntry,
  BookingLedgerResponse,
  BookingLedgerSort,
  CreateHistoricalBookingInput,
  ErpAgentsResponse,
  ErpBookingDetailResponse,
  ErpDashboardResponse,
  ErpFinanceFilter,
  ErpMoneyManagerResponse,
  ErpReportKind,
  Invoice,
  InvoiceListResponse,
  InvoiceSendResult,
  InvoiceStatus,
  InvoiceType,
  OrgSettings,
  ReassignBookingResult,
  TeamListResponse,
  TeamMember,
  UpdateInvoiceInput,
  UpdateOrgSettingsInput,
} from "@roomadda/shared";
import { api } from "../lib/api";
import { downloadBlob } from "../lib/download";

/** Sort direction for the ledger (shared exposes the schema, not the type). */
type SortOrder = "asc" | "desc";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Flatten the §15.3 global finance filter into query params (all optional). */
function filterParams(f: ErpFinanceFilter): Record<string, number | string | undefined> {
  return {
    financialYear: f.financialYear,
    quarter: f.quarter,
    month: f.month,
    listingId: f.listingId,
    agentId: f.agentId,
  };
}

/** Filters for the bookings ledger (§15.3) — everything except pagination. */
export interface LedgerFilter {
  approval?: string;
  listingId?: string;
  agentId?: string;
  tenantId?: string;
  q?: string;
  sort?: BookingLedgerSort;
  order?: SortOrder;
}

function ledgerParams(f: LedgerFilter): Record<string, string | undefined> {
  return {
    approval: f.approval,
    listingId: f.listingId,
    agentId: f.agentId,
    tenantId: f.tenantId,
    q: f.q,
    sort: f.sort,
    order: f.order,
  };
}

/** Invoice Center list filters (§15.7). */
export interface InvoiceFilter {
  type: InvoiceType;
  status?: InvoiceStatus;
  q?: string;
}

/**
 * The ERP finance surface (§15). Mirrors `api/admin.ts` (same auth interceptor via
 * the shared `api` client). Every figure returned is engine-priced integer paise —
 * the client only formats it (see /CLAUDE.md money rule), never computes it.
 */
export const erpApi = {
  // ---- ERP-4 Dashboard (§15.3): headline + charts + top agents, one global filter ----
  dashboard: (filter: ErpFinanceFilter) =>
    api.get<ErpDashboardResponse>(`/v1/erp/dashboard${qs(filterParams(filter))}`),

  // ---- ERP-4 Money Manager (§15.3): month-by-month + running balance + customers ----
  moneyManager: (filter: ErpFinanceFilter) =>
    api.get<ErpMoneyManagerResponse>(`/v1/erp/money-manager${qs(filterParams(filter))}`),

  // ---- ERP-4 Agents (§15.3): scorecards + leaderboard ----
  agentsFinance: (filter: ErpFinanceFilter) =>
    api.get<ErpAgentsResponse>(`/v1/erp/agents${qs(filterParams(filter))}`),

  /** Reassign a booking's agent attribution → commission/leaderboard recalc (audited). */
  reassignBooking: (bookingId: string, agentId: string) =>
    api.post<{ result: ReassignBookingResult }>(`/v1/erp/agents/bookings/${bookingId}/reassign`, { agentId }),

  // ---- ERP-2 Bookings ledger (§15.3): searchable/sortable, engine-priced per row ----
  bookingsLedger: (filter: LedgerFilter, cursor: string | undefined, limit: number) =>
    api.get<BookingLedgerResponse>(`/v1/erp/bookings${qs({ ...ledgerParams(filter), cursor, limit })}`),

  getBooking: (bookingId: string) =>
    api.get<ErpBookingDetailResponse>(`/v1/erp/bookings/${bookingId}`),

  addHistoricalBooking: (body: CreateHistoricalBookingInput) =>
    api.post<{ entry: BookingLedgerEntry }>(`/v1/erp/bookings`, body),

  /** Download the current-filter ledger as CSV or Excel (server-generated file). */
  exportBookings: async (filter: LedgerFilter, format: "csv" | "xlsx") => {
    const blob = await api.getBlob(`/v1/erp/bookings/export${qs({ ...ledgerParams(filter), format })}`);
    const stamp = new Date().toISOString().slice(0, 10);
    const ext = format === "csv" ? "csv" : "xls";
    downloadBlob(blob, `roomadda-bookings-${stamp}.${ext}`);
  },

  // ---- ERP-2 Approvals (§15.3): the pending-decision queue + audited actions ----
  approvals: (cursor: string | undefined, limit: number) =>
    api.get<BookingApprovalsResponse>(`/v1/erp/approvals${qs({ cursor, limit })}`),

  approveBooking: (bookingId: string) =>
    api.post<{ decision: BookingApprovalDecision }>(`/v1/erp/approvals/${bookingId}/approve`),

  rejectBooking: (bookingId: string, reason: string) =>
    api.post<{ decision: BookingApprovalDecision }>(`/v1/erp/approvals/${bookingId}/reject`, { reason }),

  bulkApprove: (bookingIds: string[]) =>
    api.post<BookingBulkApproveResult>(`/v1/erp/approvals/approve`, { bookingIds }),

  // ---- ERP-3 Invoice Center (§15.6/§15.7): two invoices per booking, engine-priced ----
  listInvoices: (filter: InvoiceFilter, cursor: string | undefined, limit: number) =>
    api.get<InvoiceListResponse>(
      `/v1/erp/invoices${qs({ type: filter.type, status: filter.status, q: filter.q, cursor, limit })}`,
    ),

  reviewInvoice: (bookingId: string, type: InvoiceType) =>
    api.get<{ invoice: Invoice }>(`/v1/erp/invoices/${bookingId}${qs({ type })}`),

  /** Edit ONLY the manual figures (maintenance/electricity/amount-paid); the server
   *  recomputes and returns the authoritative invoice (engine lines untouched). */
  updateInvoice: (bookingId: string, type: InvoiceType, body: UpdateInvoiceInput) =>
    api.patch<{ invoice: Invoice }>(`/v1/erp/invoices/${bookingId}${qs({ type })}`, body),

  sendInvoice: (bookingId: string, type: InvoiceType) =>
    api.post<{ invoice: Invoice }>(`/v1/erp/invoices/${bookingId}/send${qs({ type })}`),

  markInvoiceSent: (bookingId: string, type: InvoiceType) =>
    api.post<{ invoice: Invoice }>(`/v1/erp/invoices/${bookingId}/mark-sent${qs({ type })}`),

  /** "Comm": generate + send the COMMISSION invoice PDF to the PG owner. */
  sendCommissionInvoice: (bookingId: string) =>
    api.post<{ invoice: Invoice }>(`/v1/erp/invoices/${bookingId}/comm`),

  bulkSendInvoices: (type: InvoiceType, bookingIds: string[]) =>
    api.post<InvoiceSendResult>(`/v1/erp/invoices/send`, { type, bookingIds }),

  /** Generate + download the invoice PDF (authed blob path). */
  downloadInvoicePdf: async (bookingId: string, type: InvoiceType) => {
    const blob = await api.getBlob(`/v1/erp/invoices/${bookingId}/pdf${qs({ type })}`);
    downloadBlob(blob, `roomadda-invoice-${type.toLowerCase()}-${bookingId}.pdf`);
  },

  // ---- ERP-5 CA & Compliance (§15.3/§15.7): one-click .xlsx pack + the six reports ----
  downloadCaPack: async (financialYear?: number) => {
    const blob = await api.getBlob(`/v1/erp/ca-pack${qs({ financialYear })}`);
    downloadBlob(blob, `roomadda-ca-pack${financialYear ? `-FY${financialYear}` : ""}.xlsx`);
  },

  downloadReport: async (report: ErpReportKind, financialYear: number | undefined, format: "xlsx" | "csv") => {
    const blob = await api.getBlob(`/v1/erp/reports/${report}${qs({ financialYear, format })}`);
    const fy = financialYear ? `-FY${financialYear}` : "";
    downloadBlob(blob, `roomadda-${report}${fy}.${format === "csv" ? "csv" : "xlsx"}`);
  },

  // ---- ERP-5 Settings (§15.7): company details / operating modes / active FY + team ----
  getSettings: () => api.get<{ settings: OrgSettings }>(`/v1/erp/settings`),

  updateSettings: (body: UpdateOrgSettingsInput) =>
    api.put<{ settings: OrgSettings }>(`/v1/erp/settings`, body),

  listTeam: () => api.get<TeamListResponse>(`/v1/erp/team`),

  addTeamMember: (body: AddTeamMemberInput) =>
    api.post<{ member: TeamMember }>(`/v1/erp/team`, body),
};
