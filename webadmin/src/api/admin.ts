import type {
  AdPendingItem,
  BookingItem,
  CashInHandItem,
  CashQueueItem,
  KycReviewItem,
  ListingReviewItem,
  MetricsDTO,
  Page,
  PaymentItem,
  UserRole,
} from "@roomadda/shared";
import { api } from "../lib/api";

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const adminApi = {
  // ---- Dashboard metrics (one cached snapshot) ----
  getMetrics: () => api.get<MetricsDTO>("/v1/metrics"),

  // ---- KYC ----
  listKyc: (cursor: string | undefined, limit: number, status: string) =>
    api.get<Page<KycReviewItem>>(`/v1/admin/kyc${qs({ cursor, limit, status })}`),
  approveKyc: (id: string) => api.post(`/v1/admin/kyc/${id}/approve`),
  rejectKyc: (id: string, reason: string) => api.post(`/v1/admin/kyc/${id}/reject`, { reason }),

  // ---- Listings ----
  listListings: (cursor: string | undefined, limit: number, status: string) =>
    api.get<Page<ListingReviewItem>>(`/v1/admin/listings${qs({ cursor, limit, status })}`),
  publishListing: (id: string) => api.post(`/v1/admin/listings/${id}/publish`),
  suspendListing: (id: string) => api.post(`/v1/admin/listings/${id}/suspend`),

  // ---- Bookings & payments ----
  searchBookings: (cursor: string | undefined, limit: number, status?: string) =>
    api.get<Page<BookingItem>>(`/v1/admin/bookings${qs({ cursor, limit, status })}`),
  searchPayments: (cursor: string | undefined, limit: number, status?: string) =>
    api.get<Page<PaymentItem>>(`/v1/admin/payments${qs({ cursor, limit, status })}`),

  // ---- Cash reconciliation ----
  cashInHand: (cursor: string | undefined, limit: number) =>
    api.get<Page<CashInHandItem>>(`/v1/admin/agents/cash-in-hand${qs({ cursor, limit })}`),
  reconciliationQueue: (cursor: string | undefined, limit: number) =>
    api.get<Page<CashQueueItem>>(`/v1/admin/cash-collections${qs({ cursor, limit })}`),
  reconcile: (id: string) => api.patch(`/v1/cash-collections/${id}/reconcile`),

  // ---- Ads ----
  pendingAds: (cursor: string | undefined, limit: number) =>
    api.get<Page<AdPendingItem>>(`/v1/ads/pending${qs({ cursor, limit })}`),
  approveAd: (id: string) => api.post(`/v1/ads/${id}/approve`),
  rejectAd: (id: string, reason: string) => api.post(`/v1/ads/${id}/reject`, { reason }),
  putAdPricing: (slotType: string, pricePaise: number, isActive: boolean) =>
    api.put(`/v1/ad-pricing/${slotType}`, { pricePaise, isActive }),

  // ---- Users / roles ----
  changeUserRole: (userId: string, role: UserRole) => api.patch(`/v1/users/${userId}/role`, { role }),
};
