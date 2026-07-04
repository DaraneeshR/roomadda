import type {
  AdPendingItem,
  AdminAgentListItem,
  AdminAgentVisit,
  AdminBadgeListResponse,
  AdminBroadcastDTO,
  AdminHostDetail,
  AdminHostListItem,
  BlogPostDTO,
  BookingItem,
  BroadcastAudience,
  BroadcastChannel,
  CashInHandItem,
  CashQueueItem,
  FaqDTO,
  HomepageFeatureDTO,
  KycReviewItem,
  LandingPageDTO,
  ListingReviewItem,
  MetricsDTO,
  ModerateUserInput,
  Page,
  PaymentItem,
  ServiceRequestAdminDetail,
  ServiceRequestAdminItem,
  TestimonialDTO,
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

  // ---- Service-request oversight (§7.9) ----
  listServiceRequests: (cursor: string | undefined, limit: number, escalated?: boolean) =>
    api.get<Page<ServiceRequestAdminItem>>(
      `/v1/admin/service-requests${qs({ cursor, limit, escalated: escalated === undefined ? undefined : String(escalated) })}`,
    ),
  getServiceRequest: (id: string) =>
    api.get<{ request: ServiceRequestAdminDetail }>(`/v1/admin/service-requests/${id}`),
  resolveServiceRequest: (id: string, reason: string) =>
    api.post<{ request: ServiceRequestAdminDetail }>(`/v1/admin/service-requests/${id}/resolve`, { reason }),
  contactHost: (id: string, message: string) =>
    api.post<{ request: ServiceRequestAdminDetail }>(`/v1/admin/service-requests/${id}/contact-host`, { message }),

  // ---- Trust-tag & Featured control (§7.10) ----
  listListingBadges: (listingId: string) =>
    api.get<AdminBadgeListResponse>(`/v1/admin/listings/${listingId}/badges`),
  suspendBadge: (listingId: string, kind: string, reason: string) =>
    api.post(`/v1/admin/listings/${listingId}/badges/${kind}/suspend`, { reason }),
  unsuspendBadge: (listingId: string, kind: string) =>
    api.post(`/v1/admin/listings/${listingId}/badges/${kind}/unsuspend`),
  grantFeatured: (listingId: string, body: { durationDays?: number; startDate?: string; endDate?: string }) =>
    api.post(`/v1/admin/listings/${listingId}/badges`, { kind: "FEATURED", ...body }),

  // ---- Host management (§7.4) ----
  listHosts: (cursor: string | undefined, limit: number, status?: string, search?: string) =>
    api.get<Page<AdminHostListItem>>(`/v1/admin/hosts${qs({ cursor, limit, status, search })}`),
  getHost: (id: string) => api.get<{ host: AdminHostDetail }>(`/v1/admin/hosts/${id}`),
  moderateHost: (id: string, body: ModerateUserInput) =>
    api.post<{ host: AdminHostDetail }>(`/v1/admin/hosts/${id}/moderate`, body),
  flagHost: (id: string, reason: string, serviceRequestId?: string) =>
    api.post<{ host: AdminHostDetail }>(`/v1/admin/hosts/${id}/flag`, { reason, serviceRequestId }),
  takedownListing: (listingId: string, reason: string) =>
    api.post(`/v1/admin/listings/${listingId}/takedown`, { reason }),

  // ---- Agent management (§7.5) ----
  listAgents: (cursor: string | undefined, limit: number, status?: string, city?: string) =>
    api.get<Page<AdminAgentListItem>>(`/v1/admin/agents-list${qs({ cursor, limit, status, city })}`),
  createAgent: (body: { fullName: string; phone: string; assignedCity: string; email?: string }) =>
    api.post<{ agent: AdminAgentListItem }>(`/v1/admin/agents`, body),
  updateAgentTerritory: (id: string, assignedCity: string) =>
    api.patch<{ agent: AdminAgentListItem }>(`/v1/admin/agents/${id}/territory`, { assignedCity }),
  moderateAgent: (id: string, body: ModerateUserInput) =>
    api.post<{ agent: AdminAgentListItem }>(`/v1/admin/agents/${id}/moderate`, body),
  assignVisit: (body: { listingId: string; agentId: string; scheduledAt: string }) =>
    api.post<{ visit: AdminAgentVisit }>(`/v1/admin/agent-visits`, body),

  // ---- CMS + SEO (§7.11) ----
  listBlog: (cursor: string | undefined, limit: number) =>
    api.get<Page<BlogPostDTO>>(`/v1/admin/cms/blog${qs({ cursor, limit })}`),
  createBlog: (body: Record<string, unknown>) => api.post<{ post: BlogPostDTO }>(`/v1/admin/cms/blog`, body),
  updateBlog: (id: string, body: Record<string, unknown>) =>
    api.patch<{ post: BlogPostDTO }>(`/v1/admin/cms/blog/${id}`, body),
  deleteBlog: (id: string) => api.del(`/v1/admin/cms/blog/${id}`),
  listFaqs: () => api.get<{ items: FaqDTO[] }>(`/v1/admin/cms/faqs`),
  createFaq: (body: Record<string, unknown>) => api.post<{ faq: FaqDTO }>(`/v1/admin/cms/faqs`, body),
  updateFaq: (id: string, body: Record<string, unknown>) => api.patch<{ faq: FaqDTO }>(`/v1/admin/cms/faqs/${id}`, body),
  deleteFaq: (id: string) => api.del(`/v1/admin/cms/faqs/${id}`),
  listTestimonials: () => api.get<{ items: TestimonialDTO[] }>(`/v1/admin/cms/testimonials`),
  createTestimonial: (body: Record<string, unknown>) =>
    api.post<{ testimonial: TestimonialDTO }>(`/v1/admin/cms/testimonials`, body),
  updateTestimonial: (id: string, body: Record<string, unknown>) =>
    api.patch<{ testimonial: TestimonialDTO }>(`/v1/admin/cms/testimonials/${id}`, body),
  deleteTestimonial: (id: string) => api.del(`/v1/admin/cms/testimonials/${id}`),
  listLanding: (cursor: string | undefined, limit: number) =>
    api.get<Page<LandingPageDTO>>(`/v1/admin/cms/landing${qs({ cursor, limit })}`),
  createLanding: (body: Record<string, unknown>) => api.post<{ page: LandingPageDTO }>(`/v1/admin/cms/landing`, body),
  updateLanding: (id: string, body: Record<string, unknown>) =>
    api.patch<{ page: LandingPageDTO }>(`/v1/admin/cms/landing/${id}`, body),
  deleteLanding: (id: string) => api.del(`/v1/admin/cms/landing/${id}`),
  getHomepage: () => api.get<{ items: HomepageFeatureDTO[] }>(`/v1/admin/cms/homepage`),
  setHomepage: (listingIds: string[]) => api.put<{ items: HomepageFeatureDTO[] }>(`/v1/admin/cms/homepage`, { listingIds }),

  // ---- Notifications & broadcast (§7.12) ----
  listBroadcasts: (cursor: string | undefined, limit: number, status?: string) =>
    api.get<Page<AdminBroadcastDTO>>(`/v1/admin/broadcasts${qs({ cursor, limit, status })}`),
  createBroadcast: (body: {
    channel: BroadcastChannel;
    audience: BroadcastAudience;
    audienceValue?: string;
    title: string;
    body: string;
    deepLink?: string;
    scheduledAt?: string;
  }) => api.post<{ broadcast: AdminBroadcastDTO }>(`/v1/admin/broadcasts`, body),
  sendBroadcast: (id: string) => api.post<{ broadcast: AdminBroadcastDTO }>(`/v1/admin/broadcasts/${id}/send`),
  cancelBroadcast: (id: string) => api.post<{ broadcast: AdminBroadcastDTO }>(`/v1/admin/broadcasts/${id}/cancel`),
};
