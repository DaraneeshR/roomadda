import { z } from "zod";

/**
 * API contracts shared across the backend and the web/admin/mobile clients —
 * the single source of truth for API shapes (see /CLAUDE.md). Response DTOs
 * mirror the backend serializers.
 *
 * Request (input) zod schemas live alongside these in `requests.ts`; the
 * backend modules re-export both from here so there is exactly one definition
 * per contract.
 */

// ---------------------------------------------------------------------------
// Pagination (cursor-based, see /CLAUDE.md)
// ---------------------------------------------------------------------------
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Enums — each yields both a TS type and a runtime value list (for selects).
// ---------------------------------------------------------------------------
export const userRoleSchema = z.enum(["TENANT", "HOST", "AGENT", "ADMIN"]);
export type UserRole = z.infer<typeof userRoleSchema>;
export const USER_ROLES = userRoleSchema.options;

export const kycStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED"]);
export type KycStatus = z.infer<typeof kycStatusSchema>;
export const KYC_STATUSES = kycStatusSchema.options;

export const listingStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "PUBLISHED", "SUSPENDED"]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;
export const LISTING_STATUSES = listingStatusSchema.options;

export const bookingStatusSchema = z.enum([
  "INITIATED",
  "TOKEN_PENDING",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export const BOOKING_STATUSES = bookingStatusSchema.options;

export const paymentStatusSchema = z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export const PAYMENT_STATUSES = paymentStatusSchema.options;

export const cashCollectionStatusSchema = z.enum(["PENDING", "COLLECTED", "DEPOSITED", "RECONCILED"]);
export type CashCollectionStatus = z.infer<typeof cashCollectionStatusSchema>;

export const paymentMethodSchema = z.enum(["RAZORPAY", "CASH", "SPLIT"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export const PAYMENT_METHODS = paymentMethodSchema.options;

export const transactionStatusSchema = z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const adSlotTypeSchema = z.enum(["DAY", "WEEK"]);
export type AdSlotType = z.infer<typeof adSlotTypeSchema>;
export const AD_SLOT_TYPES = adSlotTypeSchema.options;

export const adSlotStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
]);
export type AdSlotStatus = z.infer<typeof adSlotStatusSchema>;

export const genderPolicySchema = z.enum(["MALE", "FEMALE", "COED"]);
export type GenderPolicy = z.infer<typeof genderPolicySchema>;
export const GENDER_POLICIES = genderPolicySchema.options;

/** A person's gender (distinct from a listing's GenderPolicy). UNDISCLOSED = "prefer not to say". */
export const userGenderSchema = z.enum(["MALE", "FEMALE", "UNDISCLOSED"]);
export type UserGender = z.infer<typeof userGenderSchema>;
export const USER_GENDERS = userGenderSchema.options;

export const occupationTypeSchema = z.enum(["STUDENT", "WORKING_PROFESSIONAL"]);
export type OccupationType = z.infer<typeof occupationTypeSchema>;
export const OCCUPATION_TYPES = occupationTypeSchema.options;

// ---------------------------------------------------------------------------
// Listing DTOs. These mirror the backend listing serializer (see /CLAUDE.md
// domain rule #4 on masking). The PUBLIC shape NEVER carries actualName,
// fullAddress, pincode, or exact latitude/longitude; the PRIVATE shape is only
// ever returned to the owning host / admin / agent / confirmed tenant.
// ---------------------------------------------------------------------------
export const publicListingPhotoSchema = z.object({
  id: z.string(),
  url: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.number(),
});
export type PublicListingPhoto = z.infer<typeof publicListingPhotoSchema>;

export const publicRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  floor: z.number().nullable(),
  sharingType: z.number(),
  monthlyRentPaise: z.number(),
  depositPaise: z.number(),
  totalBeds: z.number(),
  availableBeds: z.number(),
});
export type PublicRoom = z.infer<typeof publicRoomSchema>;

/** Fields common to both the masked and unmasked listing shapes. */
const commonListingSchema = z.object({
  id: z.string(),
  alias: z.string(),
  areaLabel: z.string(),
  city: z.string(),
  gender: genderPolicySchema,
  status: listingStatusSchema,
  amenities: z.array(z.string()),
  priceFromPaise: z.number().nullable(),
  photos: z.array(publicListingPhotoSchema),
  rooms: z.array(publicRoomSchema),
  createdAt: z.string(),
});

export const publicListingSchema = commonListingSchema.extend({
  masked: z.literal(true),
  /** Coarse area marker (~1 km). Exact geo is never exposed publicly. */
  approxLocation: z.object({ lat: z.number(), lng: z.number() }),
});
export type PublicListing = z.infer<typeof publicListingSchema>;

export const privateListingSchema = commonListingSchema.extend({
  masked: z.literal(false),
  hostId: z.string(),
  actualName: z.string(),
  fullAddress: z.string(),
  pincode: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }),
});
export type PrivateListing = z.infer<typeof privateListingSchema>;

export type NearbyListing = PublicListing & { distanceMeters: number };

// ---------------------------------------------------------------------------
// Tenant booking-read DTOs — what the mobile payment screen polls to observe
// the webhook-driven transition to CONFIRMED (see /CLAUDE.md domain rule #2:
// payment truth is the verified webhook, never the client). The `listing` field
// is the PRIVATE shape only once the booking is CONFIRMED, otherwise PUBLIC.
// ---------------------------------------------------------------------------

/** Per-leg payment summary. `online`/`cash` are null when that leg is absent. */
export const paymentSummarySchema = z.object({
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  online: z
    .object({
      status: transactionStatusSchema,
      /** Set by the verified `payment.captured` webhook; null until captured. */
      capturedAt: z.string().nullable(),
    })
    .nullable(),
  cash: z.object({ status: cashCollectionStatusSchema }).nullable(),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;

export const bookingDetailSchema = z.object({
  id: z.string(),
  bedId: z.string(),
  listingId: z.string(),
  status: bookingStatusSchema,
  tokenAmountPaise: z.number(),
  monthlyRentPaise: z.number(),
  depositPaise: z.number(),
  moveInDate: z.string().nullable(),
  /** Hold expiry; the bed is swept back to AVAILABLE after this if unpaid. */
  holdExpiresAt: z.string().nullable(),
  /** Set only when the booking has been CONFIRMED by settlement. */
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  /** Masked until CONFIRMED, then the unmasked private listing. */
  listing: z.union([publicListingSchema, privateListingSchema]),
  /** Null until a payment has been initiated for the booking. */
  payment: paymentSummarySchema.nullable(),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

/** GET /v1/bookings/:id response. */
export const bookingDetailResponseSchema = z.object({ booking: bookingDetailSchema });
export type BookingDetailResponse = z.infer<typeof bookingDetailResponseSchema>;

/** GET /v1/bookings response (cursor-paginated, newest first). */
export const bookingListResponseSchema = z.object({
  items: z.array(bookingDetailSchema),
  nextCursor: z.string().nullable(),
});
export type BookingListResponse = z.infer<typeof bookingListResponseSchema>;

// ---------------------------------------------------------------------------
// KYC view DTOs. The mobile app reads its own status to drive the booking gate
// (NOT_SUBMITTED / PENDING / VERIFIED / REJECTED) — this GET is also how the
// tenant learns an admin's decision. Documents themselves are never returned.
// ---------------------------------------------------------------------------

/** Caller-facing status; NOT_SUBMITTED extends the stored statuses for "no record yet". */
export const kycViewStatusSchema = z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED"]);
export type KycViewStatus = z.infer<typeof kycViewStatusSchema>;

/** GET /v1/kyc/me response. */
export const kycMeResponseSchema = z.object({
  status: kycViewStatusSchema,
  /** Present only when status is REJECTED. */
  rejectReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
  /** When an admin last verified/rejected, if ever. */
  reviewedAt: z.string().nullable(),
});
export type KycMeResponse = z.infer<typeof kycMeResponseSchema>;

/** POST /v1/kyc/upload-url response — a short-lived presigned PUT URL + its key. */
export const kycUploadUrlResponseSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type KycUploadUrlResponse = z.infer<typeof kycUploadUrlResponseSchema>;

/** POST /v1/kyc response — the record is (re)submitted and back in PENDING. */
export const kycSubmitResponseSchema = z.object({
  status: z.literal("PENDING"),
  submittedAt: z.string(),
});
export type KycSubmitResponse = z.infer<typeof kycSubmitResponseSchema>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const selfUserSchema = z.object({
  id: z.string(),
  role: userRoleSchema,
  phone: z.string(),
  fullName: z.string(),
  isPhoneVerified: z.boolean(),
  createdAt: z.string(),
  // Self-managed profile (null until set via PATCH /v1/me). Returned ONLY to the
  // user themselves — `gender` is NEVER exposed to hosts (see /CLAUDE.md privacy).
  gender: userGenderSchema.nullable(),
  dateOfBirth: z.string().nullable(),
  occupationType: occupationTypeSchema.nullable(),
  college: z.string().nullable(),
  company: z.string().nullable(),
});
export type SelfUser = z.infer<typeof selfUserSchema>;

/** Web verify/refresh response (refresh token is delivered as an httpOnly cookie). */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  user: selfUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const e164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid E.164 phone, e.g. +9198…");

// ---------------------------------------------------------------------------
// Admin surface response DTOs
// ---------------------------------------------------------------------------
export interface KycReviewItem {
  id: string;
  status: KycStatus;
  docType: string;
  user: { id: string; phone: string; fullName: string; role: UserRole };
  createdAt: string;
}

export interface ListingReviewItem {
  id: string;
  alias: string;
  actualName: string;
  city: string;
  status: ListingStatus;
  hostId: string;
  createdAt: string;
}

export interface BookingItem {
  id: string;
  status: BookingStatus;
  tenantId: string;
  listingId: string;
  bedId: string;
  tokenAmountPaise: number;
  confirmedAt: string | null;
  createdAt: string;
}

export interface PaymentItem {
  id: string;
  bookingId: string;
  amountPaise: number;
  status: PaymentStatus;
  method: string;
  razorpayOrderId: string | null;
  createdAt: string;
}

export interface CashQueueItem {
  id: string;
  amountPaise: number;
  status: CashCollectionStatus;
  collectedAt: string | null;
  agent: { id: string; fullName: string; phone: string };
  booking: { id: string; listingId: string; tenantId: string };
}

export interface CashInHandItem {
  agentId: string;
  agentName: string | null;
  agentPhone: string | null;
  cashInHandPaise: number;
}

export interface AdPendingItem {
  id: string;
  listing: { id: string; alias: string; city: string; status: ListingStatus };
  slotType: AdSlotType;
  startDate: string;
  endDate: string;
  pricePaise: number;
  status: AdSlotStatus;
  paidAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics (GET /v1/metrics) — ONE cheap, Redis-cached snapshot
// that powers the admin Dashboard. Every figure comes from grouped COUNT/SUM
// queries on the backend (never by loading rows), and money stays integer
// paise (see /CLAUDE.md). `bookings` always carries every BookingStatus (0 when
// absent) so the client shape is stable.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Health (liveness + readiness) — unversioned endpoints for orchestrators.
// ---------------------------------------------------------------------------

/** Liveness — process is up. Cheap, no dependency checks. */
export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  uptimeSeconds: z.number().int().nonnegative(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

/** Readiness — dependencies are reachable (DB + PostGIS + Redis). */
export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    database: z.string(),
    postgis: z.string(),
    redis: z.string(),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** Liveness payload returned by every service's health endpoint. */
export const healthStatusSchema = livenessResponseSchema;
export type HealthStatus = LivenessResponse;

export const metricsSchema = z.object({
  listings: z.object({
    total: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
  }),
  /** Booking counts keyed by status; every status is present (0 when none). */
  bookings: z.record(bookingStatusSchema, z.number().int().nonnegative()),
  payments: z.object({
    /**
     * Online payments captured within the configurable settlement window
     * (METRICS_PAYMENTS_WINDOW_HOURS on the backend, default 24h).
     */
    settledCountToday: z.number().int().nonnegative(),
    settledPaiseToday: z.number().int().nonnegative(),
  }),
  kycPending: z.number().int().nonnegative(),
  adsPendingApproval: z.number().int().nonnegative(),
  /** Cash collected by agents but not yet reconciled, in paise. */
  agentCashInHandPaise: z.number().int().nonnegative(),
  /** When this snapshot was computed (ISO 8601). */
  generatedAt: z.string(),
});
export type MetricsDTO = z.infer<typeof metricsSchema>;
