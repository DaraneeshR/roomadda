import type {
  BookingApprovalDecision,
  BookingApprovalsResponse,
  BookingBulkApproveResult,
  BookingLedgerEntry,
  BookingLedgerResponse,
  BookingLedgerSort,
  CreateHistoricalBookingInput,
  ErpBookingDetailResponse,
  ErpDashboardResponse,
  ErpFinanceFilter,
} from "@roomadda/shared";

/** Sort direction for the ledger (shared exposes the schema, not the type). */
type SortOrder = "asc" | "desc";
import { api } from "../lib/api";
import { downloadBlob } from "../lib/download";

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

/**
 * The ERP finance surface (§15). Mirrors `api/admin.ts` (same auth interceptor via
 * the shared `api` client). Every figure returned is engine-priced integer paise —
 * the client only formats it (see /CLAUDE.md money rule), never computes it.
 */
export const erpApi = {
  // ---- ERP-4 Dashboard (§15.3): headline + charts + top agents, one global filter ----
  dashboard: (filter: ErpFinanceFilter) =>
    api.get<ErpDashboardResponse>(`/v1/erp/dashboard${qs(filterParams(filter))}`),

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
};
