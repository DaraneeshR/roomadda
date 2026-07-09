import type {
  AddRevisionInput,
  BuildQuotationInput,
  CorporateBooking,
  CorporateCompany,
  CorporateEnquiry,
  CorporateFinanceSummary,
  CorporateInvoice,
  CreateCompanyInput,
  EnquiryStatus,
  Page,
  Quotation,
  SettleInvoiceOfflineInput,
} from "@roomadda/shared";
import { api } from "../lib/api";

/**
 * Admin corporate-ops API — the CRM/sales pipeline + corporate finance. Every
 * path is an ADMIN-gated backend route (default-deny) and every mutation is
 * AUDITED server-side (writeAudit). Money is read straight from the engine-sourced
 * DTOs; the admin console never computes an amount.
 */

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const corporateApi = {
  // Companies
  listCompanies: (cursor?: string, limit = 20) =>
    api.get<Page<CorporateCompany>>(`/v1/corporate/admin/companies${qs({ cursor, limit })}`),
  createCompany: (body: CreateCompanyInput) =>
    api.post<{ company: CorporateCompany }>("/v1/corporate/admin/companies", body),
  assignAccountManager: (companyId: string, accountManagerId: string | null) =>
    api.post<{ company: CorporateCompany }>(`/v1/corporate/admin/companies/${companyId}/account-manager`, { accountManagerId }),

  // Pipeline (enquiries)
  listPipeline: (status: EnquiryStatus | undefined, cursor?: string, limit = 20) =>
    api.get<Page<CorporateEnquiry>>(`/v1/corporate/admin/enquiries${qs({ status, cursor, limit })}`),

  // Quotations
  listQuotations: (companyId?: string, cursor?: string, limit = 20) =>
    api.get<Page<Quotation>>(`/v1/corporate/admin/quotations${qs({ companyId, cursor, limit })}`),
  getQuotation: (id: string) => api.get<{ quotation: Quotation }>(`/v1/corporate/admin/quotations/${id}`),
  buildQuotation: (body: BuildQuotationInput) =>
    api.post<{ quotation: Quotation }>("/v1/corporate/admin/quotations", body),
  addRevision: (id: string, body: AddRevisionInput) =>
    api.post<{ quotation: Quotation }>(`/v1/corporate/admin/quotations/${id}/revisions`, body),
  sendQuotation: (id: string) => api.post<{ quotation: Quotation }>(`/v1/corporate/admin/quotations/${id}/send`),
  convertQuotation: (id: string) => api.post<{ booking: CorporateBooking }>(`/v1/corporate/admin/quotations/${id}/convert`),

  // Bookings
  listBookings: (companyId?: string, cursor?: string, limit = 20) =>
    api.get<Page<CorporateBooking>>(`/v1/corporate/admin/bookings${qs({ companyId, cursor, limit })}`),
  confirmBooking: (id: string) => api.post<{ booking: CorporateBooking }>(`/v1/corporate/admin/bookings/${id}/confirm`),
  generateInvoice: (bookingId: string) =>
    api.post<{ invoice: CorporateInvoice }>(`/v1/corporate/admin/bookings/${bookingId}/invoice`),

  // Finance / invoices
  listInvoices: (companyId?: string, cursor?: string, limit = 20) =>
    api.get<Page<CorporateInvoice>>(`/v1/corporate/admin/invoices${qs({ companyId, cursor, limit })}`),
  settleOffline: (id: string, body: SettleInvoiceOfflineInput) =>
    api.post<{ invoice: CorporateInvoice }>(`/v1/corporate/admin/invoices/${id}/settle-offline`, body),
  financeSummary: () => api.get<{ summary: CorporateFinanceSummary }>("/v1/corporate/admin/finance"),
};
