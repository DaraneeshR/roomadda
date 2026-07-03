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
  // Request-to-Book: held, awaiting host acceptance before payment unlocks.
  "PENDING_APPROVAL",
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

/** Who initiated a cancellation. Drives the refund policy: HOST/SYSTEM always
 *  get a FULL refund; TENANT is tiered by the move-in window (see refund.policy). */
export const cancelledBySchema = z.enum(["TENANT", "HOST", "SYSTEM"]);
export type CancelledBy = z.infer<typeof cancelledBySchema>;
export const CANCELLED_BY = cancelledBySchema.options;

/** Lifecycle of a gateway refund. The synchronous refund API only reaches
 *  INITIATED; ONLY the signature-verified webhook settles it to PROCESSED/FAILED
 *  (refund truth = the verified webhook, never the API response — /CLAUDE.md). */
export const refundStatusSchema = z.enum(["INITIATED", "PROCESSED", "FAILED"]);
export type RefundStatus = z.infer<typeof refundStatusSchema>;
export const REFUND_STATUSES = refundStatusSchema.options;

export const cashCollectionStatusSchema = z.enum(["PENDING", "COLLECTED", "DEPOSITED", "RECONCILED"]);
export type CashCollectionStatus = z.infer<typeof cashCollectionStatusSchema>;

export const rentInvoiceStatusSchema = z.enum(["DUE", "PAID", "OVERDUE"]);
export type RentInvoiceStatus = z.infer<typeof rentInvoiceStatusSchema>;
export const RENT_INVOICE_STATUSES = rentInvoiceStatusSchema.options;

export const serviceRequestCategorySchema = z.enum([
  "PLUMBING",
  "ELECTRICAL",
  "CLEANING",
  "APPLIANCE",
  "WIFI",
  "FURNITURE",
  "PEST_CONTROL",
  "OTHER",
]);
export type ServiceRequestCategory = z.infer<typeof serviceRequestCategorySchema>;
export const SERVICE_REQUEST_CATEGORIES = serviceRequestCategorySchema.options;

export const serviceRequestPrioritySchema = z.enum(["NORMAL", "URGENT"]);
export type ServiceRequestPriority = z.infer<typeof serviceRequestPrioritySchema>;
export const SERVICE_REQUEST_PRIORITIES = serviceRequestPrioritySchema.options;

export const serviceRequestStatusSchema = z.enum(["SUBMITTED", "ACKNOWLEDGED", "RESOLVED"]);
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>;
export const SERVICE_REQUEST_STATUSES = serviceRequestStatusSchema.options;

export const leaveNoticeStatusSchema = z.enum(["ACTIVE", "WITHDRAWN"]);
export type LeaveNoticeStatus = z.infer<typeof leaveNoticeStatusSchema>;
export const LEAVE_NOTICE_STATUSES = leaveNoticeStatusSchema.options;

export const chatMessageKindSchema = z.enum(["TEXT", "PHOTO"]);
export type ChatMessageKind = z.infer<typeof chatMessageKindSchema>;
export const CHAT_MESSAGE_KINDS = chatMessageKindSchema.options;

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
  /**
   * Token to pay now to secure a bed in THIS room (integer paise). Server-owned
   * via `effectiveTokenPaise` (host token, else deposit, else rent) and equal to
   * what booking creation charges — the app displays this value, never a guess.
   */
  tokenAmountPaise: z.number(),
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
  /** Instant Book confirms on payment; otherwise booking waits for host accept. */
  instantBook: z.boolean(),
  photos: z.array(publicListingPhotoSchema),
  rooms: z.array(publicRoomSchema),
  /**
   * Aggregate rating over this listing's published reviews. Server-computed and
   * cached on the listing (recomputed on every new review); feeds both the
   * public card and the detail view. `ratingAverage` is null for a listing with
   * zero reviews (empty state is first-class) — never a fabricated 0.
   */
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
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

/**
 * POST /v1/listings/:id/photos/upload-url response — a presigned PUT to the
 * PUBLIC bucket plus the stable `publicUrl` the client then attaches via POST
 * /v1/listings/:id/photos. (Listing photos are public, so — unlike the private
 * KYC/service photo-url responses — the served URL is returned, not just a key.)
 */
export const listingPhotoUploadUrlResponseSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  publicUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type ListingPhotoUploadUrlResponse = z.infer<typeof listingPhotoUploadUrlResponseSchema>;

// ---------------------------------------------------------------------------
// Reviews & ratings. A review is written by a tenant with an eligible stay on
// the listing (one review per booking, enforced server-side) and is PUBLIC —
// anyone browsing the listing may read it. `authorName` is the reviewer's
// display name (reviews are attributed); no other tenant PII is exposed. The
// host may attach one `hostResponse` per review.
// ---------------------------------------------------------------------------
export const reviewSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  /** 1–5 stars. */
  rating: z.number().int().min(1).max(5),
  /** Free-text body; null when the reviewer left a rating only. */
  text: z.string().nullable(),
  /** Reviewer's display name (reviews are attributed). */
  authorName: z.string(),
  /** The host's public reply, if they have responded; null otherwise. */
  hostResponse: z.string().nullable(),
  /** When the host responded (ISO 8601); null until they do. */
  respondedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

/** Aggregate summary echoed alongside a page of reviews (mirrors the listing). */
export const reviewSummarySchema = z.object({
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/** GET /v1/listings/:id/reviews — cursor-paginated, newest first, plus the
 *  aggregate for the reviews-screen header. Zero reviews returns `items: []`
 *  and `summary.ratingCount: 0` cleanly (empty state is first-class). */
export const reviewListResponseSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  summary: reviewSummarySchema,
});
export type ReviewListResponse = z.infer<typeof reviewListResponseSchema>;

/** POST /v1/listings/:id/reviews and POST /v1/reviews/:id/response responses. */
export const reviewResponseSchema = z.object({ review: reviewSchema });
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

// ---------------------------------------------------------------------------
// Social proof — HONESTY-GATED. Every number here is REAL: computed from live
// sessions / confirmed-paid bookings / live inventory / real wishlists. Each
// widget has a server-side minimum-real-value FLOOR; below it the field is
// OMITTED ENTIRELY (never zero-filled, never faked), so the client literally has
// nothing to render and cannot manufacture social proof. All fields are
// therefore optional — presence means the real value cleared its floor.
// ---------------------------------------------------------------------------

/** Genuine scarcity level for the "only N beds left" widget. */
export const scarcityLevelSchema = z.enum(["amber", "red"]);
export type ScarcityLevel = z.infer<typeof scarcityLevelSchema>;

export const socialProofSchema = z.object({
  /** Distinct sessions actively viewing right now (Redis, short TTL). Present
   *  only when the real count ≥ the viewing floor. */
  viewingNow: z.number().int().positive().optional(),
  /** Confirmed-PAID bookings (incl. walk-in + agent) in a rolling window.
   *  `count` is real; present only when ≥ the booked floor. Recomputed on a
   *  short cron and cached on the listing. */
  bookedRecently: z
    .object({ count: z.number().int().positive(), windowDays: z.number().int().positive() })
    .optional(),
  /** Genuine live scarcity from bed inventory: amber when few beds remain, red
   *  when fully booked. Omitted when there is no real scarcity to show. */
  bedsLeft: z
    .object({ count: z.number().int().nonnegative(), level: scarcityLevelSchema })
    .optional(),
  /** How many tenants have wishlisted this listing (real count). Present only
   *  when ≥ the wishlist floor. */
  wishlistedCount: z.number().int().positive().optional(),
});
export type SocialProof = z.infer<typeof socialProofSchema>;

/** GET /v1/listings/:id/social response. `social` is a (possibly empty) object;
 *  an empty object means nothing cleared its floor — the honest "show nothing". */
export const socialProofResponseSchema = z.object({ social: socialProofSchema });
export type SocialProofResponse = z.infer<typeof socialProofResponseSchema>;

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
  /** Tenant's chosen meal plan label, if any. */
  mealPlan: z.string().nullable(),
  /** Host's name — revealed ONLY once the booking is CONFIRMED (else null). */
  hostName: z.string().nullable(),
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
// Cancellation + refund (POST /v1/bookings/:id/cancel and /decline). The refund
// amount is computed server-side from the cancellation policy (see /CLAUDE.md
// domain rule #2: refund truth is the verified webhook). The response NEVER
// reports a refund as settled — `refundStatus` is PENDING while the gateway
// settles asynchronously; it only becomes settled via the refund.* webhook.
// ---------------------------------------------------------------------------
export const cancelBookingResponseSchema = z.object({
  status: z.literal("CANCELLED"),
  /** Refund owed and actually initiated, integer paise (0 when none is due or
   *  nothing was captured online to refund). */
  refundPaise: z.number().int().nonnegative(),
  /** Machine-stable policy reason code, e.g. "full_refund_window", "no_refund_window". */
  refundReason: z.string(),
  /**
   * Settlement state at this instant. PENDING = a gateway refund was INITIATED
   * and awaits the signature-verified webhook (never "refunded" here). NONE =
   * nothing was refunded (outside the window, or no online capture to refund).
   */
  refundStatus: z.enum(["PENDING", "NONE"]),
});
export type CancelBookingResponse = z.infer<typeof cancelBookingResponseSchema>;

// ---------------------------------------------------------------------------
// Active stay (GET /v1/me/active-stay) — the post-move-in tenant dashboard.
// Returned ONLY to the tenant whose CONFIRMED booking has reached its move-in
// date (moveInDate <= today); `null` otherwise (pre-move-in or no stay). The
// caller is a CONFIRMED tenant on this listing, so the real PG name is allowed
// (see /CLAUDE.md domain rule #4). The host's emergency contact IS included here
// (PRD: allowed on the dashboard, NEVER in chat). This shape deliberately
// carries NO KYC or payment data.
// ---------------------------------------------------------------------------
export const activeStaySchema = z.object({
  bookingId: z.string(),
  listingId: z.string(),
  /** Real PG name — unmasked: the caller is a CONFIRMED tenant on this listing. */
  pgName: z.string(),
  roomName: z.string(),
  /** Move-in date, already on/before today (ISO 8601). */
  moveInDate: z.string(),
  monthlyRentPaise: z.number().int().nonnegative(),
  /** Next monthly rent due date (ISO 8601), derived from the move-in date. */
  nextRentDueDate: z.string(),
  host: z.object({
    name: z.string(),
    /** Host emergency contact — dashboard only (per PRD). NEVER surfaced in chat. */
    emergencyContactNumber: z.string(),
  }),
  /** Forward-looking availability for the dashboard's quick-action cards. */
  features: z.object({
    mealMenuAvailable: z.boolean(),
    leaveNoticeAvailable: z.boolean(),
  }),
});
export type ActiveStay = z.infer<typeof activeStaySchema>;

/** GET /v1/me/active-stay response — `activeStay` is null when there is none. */
export const activeStayResponseSchema = z.object({ activeStay: activeStaySchema.nullable() });
export type ActiveStayResponse = z.infer<typeof activeStayResponseSchema>;

// ---------------------------------------------------------------------------
// Recurring monthly rent. RENT IS MONEY: an invoice is PAID ONLY via the
// signature-verified Razorpay webhook (full amount) — never app-side (see
// /CLAUDE.md domain rule #2). `status` is the EFFECTIVE status the server
// computes: PAID, else OVERDUE when past `dueDate` and unpaid, else DUE. The
// mobile shows `daysOverdue` in red when OVERDUE; it carries no payment internals.
// ---------------------------------------------------------------------------
export const rentInvoiceSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  /** First day of the billing month this invoice covers (ISO date). */
  periodMonth: z.string(),
  /** Human label for the billing month, e.g. "July 2026". */
  periodLabel: z.string(),
  amountPaise: z.number().int().nonnegative(),
  dueDate: z.string(),
  status: rentInvoiceStatusSchema,
  /** Whole days past the due date when OVERDUE; 0 otherwise. */
  daysOverdue: z.number().int().nonnegative(),
  /** Set only once the verified webhook marks the invoice PAID. */
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RentInvoice = z.infer<typeof rentInvoiceSchema>;

/** GET /v1/rent/:invoiceId response. */
export const rentInvoiceResponseSchema = z.object({ invoice: rentInvoiceSchema });
export type RentInvoiceResponse = z.infer<typeof rentInvoiceResponseSchema>;

/** GET /v1/rent response (cursor-paginated, newest first). */
export const rentListResponseSchema = z.object({
  items: z.array(rentInvoiceSchema),
  nextCursor: z.string().nullable(),
});
export type RentListResponse = z.infer<typeof rentListResponseSchema>;

/** POST /v1/rent/:invoiceId/pay response — a full-amount Razorpay order. */
export const rentPayResponseSchema = z.object({
  invoiceId: z.string(),
  amountPaise: z.number().int().positive(),
  razorpayOrder: z.object({
    orderId: z.string(),
    amount: z.number().int().positive(),
    currency: z.string(),
    keyId: z.string(),
  }),
});
export type RentPayResponse = z.infer<typeof rentPayResponseSchema>;

// ---------------------------------------------------------------------------
// Meal menu (GET /v1/listings/:id/menu) — the tenant's daily meal view. One day
// per (listing, calendar date); the endpoint returns today + tomorrow. A slot's
// `text` is the dish; `notAvailable` is the host's "not served today" flag. A
// day with no menu row at all has `notUpdated: true` ("Menu not updated yet").
// The view is transparent about who last edited it and when.
// ---------------------------------------------------------------------------
export const mealSlotSchema = z.object({
  /** Dish text; null when the host has not filled this slot. */
  text: z.string().nullable(),
  /** True when the host marked this slot as not served that day. */
  notAvailable: z.boolean(),
});
export type MealSlot = z.infer<typeof mealSlotSchema>;

export const mealMenuDaySchema = z.object({
  /** Calendar day this menu covers (ISO date). */
  date: z.string(),
  breakfast: mealSlotSchema,
  lunch: mealSlotSchema,
  dinner: mealSlotSchema,
  /** Host who last edited the menu; null when no menu exists for the day. */
  updatedByHostName: z.string().nullable(),
  /** When the menu was last edited (ISO); null when no menu exists for the day. */
  updatedAt: z.string().nullable(),
  /** True when there is no menu row for this day at all ("not updated yet"). */
  notUpdated: z.boolean(),
});
export type MealMenuDay = z.infer<typeof mealMenuDaySchema>;

/** GET /v1/listings/:id/menu response — chronological (today, tomorrow). */
export const mealMenuResponseSchema = z.object({ days: z.array(mealMenuDaySchema) });
export type MealMenuResponse = z.infer<typeof mealMenuResponseSchema>;

/** POST /v1/listings/:id/menu response — the upserted day. */
export const mealMenuUpsertResponseSchema = z.object({ day: mealMenuDaySchema });
export type MealMenuUpsertResponse = z.infer<typeof mealMenuUpsertResponseSchema>;

// ---------------------------------------------------------------------------
// Maintenance / service requests. A tenant on an active stay raises a ticket;
// the lifecycle is SUBMITTED -> ACKNOWLEDGED -> RESOLVED (host/admin drive the
// later transitions). Urgent tickets unresolved past the window are auto-flagged
// (`escalated`) for admin. Photos are stored server-side as private object keys
// and surfaced only as a count (`photoCount`) — never the raw keys.
// ---------------------------------------------------------------------------
export const serviceRequestCommentSchema = z.object({
  id: z.string(),
  authorRole: userRoleSchema,
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type ServiceRequestComment = z.infer<typeof serviceRequestCommentSchema>;

export const serviceRequestSchema = z.object({
  id: z.string(),
  ticketNumber: z.string(),
  category: serviceRequestCategorySchema,
  description: z.string(),
  priority: serviceRequestPrioritySchema,
  status: serviceRequestStatusSchema,
  /** Number of attached photos (0–3). The raw object keys are never exposed. */
  photoCount: z.number().int().nonnegative(),
  /** True once an Urgent ticket has been auto-escalated to admin. */
  escalated: z.boolean(),
  /** Tenant's 1–5 satisfaction rating, set after RESOLVED; null until then. */
  rating: z.number().int().min(1).max(5).nullable(),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

/** Detail adds the comment thread (newest activity last). */
export const serviceRequestDetailSchema = serviceRequestSchema.extend({
  comments: z.array(serviceRequestCommentSchema),
});
export type ServiceRequestDetail = z.infer<typeof serviceRequestDetailSchema>;

/** POST /v1/service-requests and GET /v1/service-requests/:id responses. */
export const serviceRequestResponseSchema = z.object({ request: serviceRequestDetailSchema });
export type ServiceRequestResponse = z.infer<typeof serviceRequestResponseSchema>;

/** GET /v1/service-requests response (cursor-paginated, newest first). */
export const serviceRequestListResponseSchema = z.object({
  items: z.array(serviceRequestSchema),
  nextCursor: z.string().nullable(),
});
export type ServiceRequestListResponse = z.infer<typeof serviceRequestListResponseSchema>;

/** POST /v1/service-requests/photo-url response — a presigned PUT for one photo. */
export const serviceRequestPhotoUrlResponseSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type ServiceRequestPhotoUrlResponse = z.infer<typeof serviceRequestPhotoUrlResponseSchema>;

/** Admin oversight item (GET /v1/admin/service-requests) — adds who/where + escalation time. */
export const serviceRequestAdminItemSchema = serviceRequestSchema.extend({
  escalatedAt: z.string().nullable(),
  tenant: z.object({ id: z.string(), fullName: z.string(), phone: z.string() }),
  listing: z.object({ id: z.string(), alias: z.string(), city: z.string() }),
});
export type ServiceRequestAdminItem = z.infer<typeof serviceRequestAdminItemSchema>;

export const serviceRequestAdminListResponseSchema = z.object({
  items: z.array(serviceRequestAdminItemSchema),
  nextCursor: z.string().nullable(),
});
export type ServiceRequestAdminListResponse = z.infer<typeof serviceRequestAdminListResponseSchema>;

// ---------------------------------------------------------------------------
// Leave notice — a tenant's notice to vacate. `moveOutDate` must be at least the
// notice period out; a notice cannot be withdrawn within 3 days of move-out
// (`canWithdraw` reflects that, computed server-side). The list response carries
// the policy so the form can validate the date without duplicating constants.
// ---------------------------------------------------------------------------
export const leaveNoticeSchema = z.object({
  id: z.string(),
  moveOutDate: z.string(),
  status: leaveNoticeStatusSchema,
  /** True only while the notice is ACTIVE and outside the 3-day lock window. */
  canWithdraw: z.boolean(),
  withdrawnAt: z.string().nullable(),
  createdAt: z.string(),
});
export type LeaveNotice = z.infer<typeof leaveNoticeSchema>;

/** POST /v1/leave-notices and withdraw responses. */
export const leaveNoticeResponseSchema = z.object({ notice: leaveNoticeSchema });
export type LeaveNoticeResponse = z.infer<typeof leaveNoticeResponseSchema>;

/** GET /v1/leave-notices — own notices (newest first) + the policy for the form. */
export const leaveNoticeListResponseSchema = z.object({
  items: z.array(leaveNoticeSchema),
  noticePeriodDays: z.number().int().nonnegative(),
  /** Earliest move-out date the tenant may choose (ISO date). */
  earliestMoveOutDate: z.string(),
});
export type LeaveNoticeListResponse = z.infer<typeof leaveNoticeListResponseSchema>;

// ---------------------------------------------------------------------------
// Safety — trusted contacts + SOS. Trusted contacts (1–3) receive an SMS with
// the user's location on SOS; the admin/ops channel is alerted too. The SOS
// endpoint always alerts admin, even with no contacts or no GPS fix.
// ---------------------------------------------------------------------------
export const trustedContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  createdAt: z.string(),
});
export type TrustedContact = z.infer<typeof trustedContactSchema>;

export const trustedContactsResponseSchema = z.object({
  items: z.array(trustedContactSchema),
  /** Max contacts a user may keep (so the client can disable "add" at the cap). */
  max: z.number().int().positive(),
});
export type TrustedContactsResponse = z.infer<typeof trustedContactsResponseSchema>;

/** POST /v1/sos response — how many contacts were SMSed and whether admin was alerted. */
export const sosResponseSchema = z.object({
  contactsNotified: z.number().int().nonnegative(),
  adminAlerted: z.boolean(),
});
export type SosResponse = z.infer<typeof sosResponseSchema>;

// ---------------------------------------------------------------------------
// Tenant <-> host chat. Real-time delivery is Firebase (Firestore + FCM); every
// message is mirrored to Postgres for admin audit. Chat is scoped to a booking
// and DISABLED once the booking is no longer CONFIRMED. Phone numbers are never
// allowed in message text (rejected server-side). Photos are private objects
// surfaced as a short-lived `photoUrl`; the raw key is never exposed.
// ---------------------------------------------------------------------------
export const chatMessageSchema = z.object({
  id: z.string(),
  kind: chatMessageKindSchema,
  /** Text body (null for a photo). */
  text: z.string().nullable(),
  /** Short-lived viewable URL for a photo (null for text). */
  photoUrl: z.string().nullable(),
  senderRole: userRoleSchema,
  /** True when the caller sent this message (drives left/right bubble alignment). */
  mine: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  /** False once the booking is no longer CONFIRMED — sending is blocked. */
  chatEnabled: z.boolean(),
  /** The other party (host) — name only; NO phone number is ever exposed in chat. */
  host: z.object({ name: z.string() }),
  /** Reassurance copy, e.g. "Usually replies within a few hours". */
  repliesWithin: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

/** GET /v1/chat/current — the conversation for the tenant's active stay (null if none). */
export const currentChatResponseSchema = z.object({ conversation: conversationSchema.nullable() });
export type CurrentChatResponse = z.infer<typeof currentChatResponseSchema>;

/** GET /v1/chat/:id/messages — cursor-paginated, newest first. */
export const chatMessageListResponseSchema = z.object({
  items: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});
export type ChatMessageListResponse = z.infer<typeof chatMessageListResponseSchema>;

/** POST /v1/chat/:id/messages response. */
export const chatMessageResponseSchema = z.object({ message: chatMessageSchema });
export type ChatMessageResponse = z.infer<typeof chatMessageResponseSchema>;

/** POST /v1/chat/photo-url response — a presigned PUT for one chat photo. */
export const chatPhotoUrlResponseSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type ChatPhotoUrlResponse = z.infer<typeof chatPhotoUrlResponseSchema>;

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

// ===========================================================================
// HOST SURFACE — endpoints consumed by BOTH the host mobile app and the web host
// portal (built once on the backend). Every host route is ownership-scoped (a
// host only ever sees/touches their OWN listings, tenants, menus) and NEVER
// exposes tenant KYC or another tenant's data (see /CLAUDE.md domain rule #4 +
// privacy rules). Money is always integer paise.
// ===========================================================================

export const walkInPaymentModeSchema = z.enum(["CASH", "UPI", "BANK_TRANSFER", "OTHER"]);
export type WalkInPaymentMode = z.infer<typeof walkInPaymentModeSchema>;
export const WALK_IN_PAYMENT_MODES = walkInPaymentModeSchema.options;

/**
 * A room's occupancy rollup for the host inventory view. Occupancy is split so
 * walk-ins (manual, BLOCKED beds) are flagged DISTINCTLY from platform bookings
 * (BOOKED beds), per the inventory spec. `needsVerification` is true when the
 * room has not been verified within the reminder window (default 3 days).
 */
export const hostRoomInventorySchema = z.object({
  roomId: z.string(),
  name: z.string(),
  floor: z.number().nullable(),
  sharingType: z.number(),
  monthlyRentPaise: z.number().int().nonnegative(),
  depositPaise: z.number().int().nonnegative(),
  totalBeds: z.number().int().nonnegative(),
  /** Beds taken by a confirmed platform booking (auto-decremented). */
  bookedBeds: z.number().int().nonnegative(),
  /** Beds taken by a host-recorded walk-in (manual adjust — flagged distinctly). */
  walkInBeds: z.number().int().nonnegative(),
  /** Beds held mid-booking (a live hold, not yet confirmed). */
  heldBeds: z.number().int().nonnegative(),
  availableBeds: z.number().int().nonnegative(),
  /** True when occupancy hasn't been verified within the reminder window. */
  needsVerification: z.boolean(),
  inventoryVerifiedAt: z.string().nullable(),
});
export type HostRoomInventory = z.infer<typeof hostRoomInventorySchema>;

/** The full host view of one of their listings (unmasked + host-only fields). */
export const hostListingSchema = z.object({
  id: z.string(),
  alias: z.string(),
  actualName: z.string(),
  areaLabel: z.string(),
  city: z.string(),
  pincode: z.string(),
  fullAddress: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  gender: genderPolicySchema,
  status: listingStatusSchema,
  /** Host pause — hidden from tenant discovery, NOT deleted. */
  paused: z.boolean(),
  instantBook: z.boolean(),
  amenities: z.array(z.string()),
  houseRules: z.array(z.string()),
  mealsOffered: z.boolean(),
  mealChargesPaise: z.number().int().nonnegative().nullable(),
  tokenAmountPaise: z.number().int().nonnegative().nullable(),
  priceFromPaise: z.number().nullable(),
  photos: z.array(publicListingPhotoSchema),
  rooms: z.array(hostRoomInventorySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HostListing = z.infer<typeof hostListingSchema>;

export const hostListingResponseSchema = z.object({ listing: hostListingSchema });
export type HostListingResponse = z.infer<typeof hostListingResponseSchema>;

export const hostListingListResponseSchema = z.object({
  items: z.array(hostListingSchema),
  nextCursor: z.string().nullable(),
});
export type HostListingListResponse = z.infer<typeof hostListingListResponseSchema>;

/**
 * Result of a host edit. `requeued` is true when the change re-queued the listing
 * for approval (a rent change > 20% or an address change — minor edits go live
 * immediately); `changedFields` lists what changed (also recorded in the log).
 */
export const hostListingEditResponseSchema = z.object({
  listing: hostListingSchema,
  requeued: z.boolean(),
  changedFields: z.array(z.string()),
});
export type HostListingEditResponse = z.infer<typeof hostListingEditResponseSchema>;

export const listingEditLogItemSchema = z.object({
  id: z.string(),
  fields: z.array(z.string()),
  requeued: z.boolean(),
  createdAt: z.string(),
});
export type ListingEditLogItem = z.infer<typeof listingEditLogItemSchema>;

export const listingEditLogResponseSchema = z.object({
  items: z.array(listingEditLogItemSchema),
  nextCursor: z.string().nullable(),
});
export type ListingEditLogResponse = z.infer<typeof listingEditLogResponseSchema>;

/**
 * An incoming booking shown in the host's "requests" feed. Request-to-Book
 * (PENDING_APPROVAL) is actionable with a 24h countdown (`secondsRemaining`);
 * Instant-Book appears already-confirmed. The host NEVER sees the tenant's KYC
 * documents — only their display name (enforced in the serializer).
 */
export const hostBookingRequestSchema = z.object({
  bookingId: z.string(),
  listingId: z.string(),
  status: bookingStatusSchema,
  /** True for an Instant-Book listing (shown already-confirmed, no action). */
  instant: z.boolean(),
  /** Tenant display name only — NO KYC, NO documents. */
  tenantName: z.string(),
  roomName: z.string(),
  bedLabel: z.string(),
  tokenAmountPaise: z.number().int().nonnegative(),
  monthlyRentPaise: z.number().int().nonnegative(),
  moveInDate: z.string().nullable(),
  requestedAt: z.string(),
  /** Host-accept deadline (PENDING_APPROVAL only); null otherwise. */
  expiresAt: z.string().nullable(),
  /** Whole seconds until `expiresAt` (0 when past); null when not applicable. */
  secondsRemaining: z.number().int().nonnegative().nullable(),
});
export type HostBookingRequest = z.infer<typeof hostBookingRequestSchema>;

export const hostBookingRequestListResponseSchema = z.object({
  items: z.array(hostBookingRequestSchema),
  nextCursor: z.string().nullable(),
});
export type HostBookingRequestListResponse = z.infer<typeof hostBookingRequestListResponseSchema>;

/**
 * A host-recorded walk-in tenant. The Aadhaar number the host typed is NEVER
 * returned in full — only the last 4 digits (`aadhaarLast4`).
 */
export const walkInTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  /** Last 4 digits of the typed Aadhaar number; the full number never leaves the server. */
  aadhaarLast4: z.string(),
  roomId: z.string(),
  roomName: z.string(),
  moveInDate: z.string(),
  monthlyRentPaise: z.number().int().nonnegative(),
  depositPaise: z.number().int().nonnegative(),
  paymentMode: walkInPaymentModeSchema,
  /** True once the app-invite SMS has been fired. */
  invited: z.boolean(),
  invitedAt: z.string().nullable(),
  checkedOutAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WalkInTenant = z.infer<typeof walkInTenantSchema>;

export const walkInResponseSchema = z.object({ walkIn: walkInTenantSchema });
export type WalkInResponse = z.infer<typeof walkInResponseSchema>;

/** Rent status shown on the roster. WALK_IN tenants are NOT_TRACKED (off-platform). */
export const rosterRentStatusSchema = z.enum(["PAID", "DUE", "OVERDUE", "NOT_TRACKED"]);
export type RosterRentStatus = z.infer<typeof rosterRentStatusSchema>;

/**
 * A roster entry — a CURRENT or PAST tenant of one of the host's listings. The
 * roster carries NO KYC and NO other tenant's data: a host sees only name, room,
 * move-in, and rent status for THEIR tenants. Past entries add move-out + duration.
 */
export const rosterTenantSchema = z.object({
  /** BOOKING = platform tenant; WALK_IN = host-recorded walk-in. */
  kind: z.enum(["BOOKING", "WALK_IN"]),
  id: z.string(),
  name: z.string(),
  roomName: z.string(),
  moveInDate: z.string().nullable(),
  monthlyRentPaise: z.number().int().nonnegative(),
  rentStatus: rosterRentStatusSchema,
  /** Past tenants only: move-out date + stay duration in days (null for current). */
  moveOutDate: z.string().nullable(),
  durationDays: z.number().int().nonnegative().nullable(),
});
export type RosterTenant = z.infer<typeof rosterTenantSchema>;

export const rosterResponseSchema = z.object({
  items: z.array(rosterTenantSchema),
  nextCursor: z.string().nullable(),
});
export type RosterResponse = z.infer<typeof rosterResponseSchema>;

/** A weekly meal template's per-day slots (reuses the tenant-facing slot shape). */
export const weeklyMenuDaySchema = z.object({
  breakfast: mealSlotSchema,
  lunch: mealSlotSchema,
  dinner: mealSlotSchema,
});
export type WeeklyMenuDay = z.infer<typeof weeklyMenuDaySchema>;

export const weeklyMenuSchema = z.object({
  mon: weeklyMenuDaySchema,
  tue: weeklyMenuDaySchema,
  wed: weeklyMenuDaySchema,
  thu: weeklyMenuDaySchema,
  fri: weeklyMenuDaySchema,
  sat: weeklyMenuDaySchema,
  sun: weeklyMenuDaySchema,
});
export type WeeklyMenu = z.infer<typeof weeklyMenuSchema>;

export const mealTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  days: weeklyMenuSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MealTemplate = z.infer<typeof mealTemplateSchema>;

export const mealTemplateListResponseSchema = z.object({ items: z.array(mealTemplateSchema) });
export type MealTemplateListResponse = z.infer<typeof mealTemplateListResponseSchema>;

/**
 * A service-request as the HOST sees it in their queue: the tenant-facing fields
 * plus the tenant's display name and room (NO KYC), and escalation time. The host
 * can acknowledge / note / resolve but NEVER delete.
 */
export const hostServiceRequestSchema = serviceRequestSchema.extend({
  tenantName: z.string(),
  roomName: z.string().nullable(),
  escalatedAt: z.string().nullable(),
  comments: z.array(serviceRequestCommentSchema),
});
export type HostServiceRequest = z.infer<typeof hostServiceRequestSchema>;

export const hostServiceQueueResponseSchema = z.object({
  items: z.array(hostServiceRequestSchema),
  nextCursor: z.string().nullable(),
  /** Queue rollups for the host dashboard. */
  stats: z.object({
    openCount: z.number().int().nonnegative(),
    escalatedCount: z.number().int().nonnegative(),
    /** Mean SUBMITTED→RESOLVED time over resolved tickets, in hours; null if none. */
    avgResolutionHours: z.number().nullable(),
  }),
});
export type HostServiceQueueResponse = z.infer<typeof hostServiceQueueResponseSchema>;

export const hostServiceRequestResponseSchema = z.object({ request: hostServiceRequestSchema });
export type HostServiceRequestResponse = z.infer<typeof hostServiceRequestResponseSchema>;

/** POST /v1/host/listings/:id/broadcast — confirms fan-out + remaining daily quota. */
export const broadcastResponseSchema = z.object({
  id: z.string(),
  body: z.string(),
  recipientCount: z.number().int().nonnegative(),
  /** Broadcasts still allowed today for this property (0–3). */
  remainingToday: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type BroadcastResponse = z.infer<typeof broadcastResponseSchema>;

/** Per-month revenue point for the last-3-months chart. */
export const revenueMonthSchema = z.object({
  periodMonth: z.string(),
  periodLabel: z.string(),
  expectedPaise: z.number().int().nonnegative(),
  collectedPaise: z.number().int().nonnegative(),
});
export type RevenueMonth = z.infer<typeof revenueMonthSchema>;

/**
 * Read-only revenue snapshot for a host listing (NO payouts in MVP). Expected =
 * sum of current-month rent invoices; collected = the PAID subset; overdue = the
 * unpaid-past-due subset. Occupancy counts live beds across the listing.
 */
export const revenueSummarySchema = z.object({
  listingId: z.string(),
  expectedPaise: z.number().int().nonnegative(),
  collectedPaise: z.number().int().nonnegative(),
  overduePaise: z.number().int().nonnegative(),
  occupiedBeds: z.number().int().nonnegative(),
  vacantBeds: z.number().int().nonnegative(),
  totalBeds: z.number().int().nonnegative(),
  /** Last 3 months (oldest first) for the chart. */
  months: z.array(revenueMonthSchema),
  generatedAt: z.string(),
});
export type RevenueSummary = z.infer<typeof revenueSummarySchema>;

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

// ---------------------------------------------------------------------------
// AGENT SURFACE (the §9.1 zone-access invariant). Agents are ADMIN-created,
// zone-scoped, default-deny. Every agent route is enforced server-side against
// the agent's assigned city — these DTOs only describe the shapes.
// ---------------------------------------------------------------------------
export const agentVisitStatusSchema = z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]);
export type AgentVisitStatus = z.infer<typeof agentVisitStatusSchema>;
export const AGENT_VISIT_STATUSES = agentVisitStatusSchema.options;

/** How an agent-attributed booking was created (same commission for both). */
export const agentBookingChannelSchema = z.enum(["ASSISTED", "WALK_IN"]);
export type AgentBookingChannel = z.infer<typeof agentBookingChannelSchema>;
export const AGENT_BOOKING_CHANNELS = agentBookingChannelSchema.options;

export const inspectionStatusSchema = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]);
export type InspectionStatus = z.infer<typeof inspectionStatusSchema>;
export const INSPECTION_STATUSES = inspectionStatusSchema.options;

export const inspectionRecommendationSchema = z.enum(["APPROVE", "APPROVE_WITH_CONDITIONS", "REJECT"]);
export type InspectionRecommendation = z.infer<typeof inspectionRecommendationSchema>;
export const INSPECTION_RECOMMENDATIONS = inspectionRecommendationSchema.options;

/** Per-amenity verdict in an inspection checklist. */
export const amenityCheckSchema = z.enum(["YES", "NO", "PARTIAL"]);
export type AmenityCheck = z.infer<typeof amenityCheckSchema>;

/** A GPS check-in on a visit (null until the agent checks in). `withinRange` is
 *  false for an out-of-range "cannot reach property" check-in; an inspection can
 *  be submitted ONLY when it is true. */
export const agentCheckInDtoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  at: z.string(),
  distanceM: z.number(),
  withinRange: z.boolean(),
});
export type AgentCheckInDto = z.infer<typeof agentCheckInDtoSchema>;

/** A property visit as the agent sees it. The agent is a privileged role, so the
 *  unmasked property identity/address is included (they must navigate to it). */
export const agentVisitSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  alias: z.string(),
  actualName: z.string(),
  areaLabel: z.string(),
  city: z.string(),
  fullAddress: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  status: agentVisitStatusSchema,
  scheduledAt: z.string(),
  visitedAt: z.string().nullable(),
  notes: z.string().nullable(),
  checkIn: agentCheckInDtoSchema.nullable(),
  inspectionStatus: inspectionStatusSchema.nullable(),
});
export type AgentVisit = z.infer<typeof agentVisitSchema>;

/** GET /v1/agent/dashboard — today's queue + actionable counts. */
export const agentDashboardSchema = z.object({
  todaysVisits: z.array(agentVisitSchema),
  /** Agent-attributed bookings still awaiting the user's payment. */
  pendingAssistedBookings: z.number().int().nonnegative(),
  /** Agent-attributed bookings CONFIRMED this calendar month. */
  closedThisMonth: z.number().int().nonnegative(),
  generatedAt: z.string(),
});
export type AgentDashboard = z.infer<typeof agentDashboardSchema>;

/** GET /v1/agent/performance — this month's read-only scorecard (manual payout). */
export const agentPerformanceSchema = z.object({
  periodMonth: z.string(),
  periodLabel: z.string(),
  visitsCompleted: z.number().int().nonnegative(),
  bookingsClosed: z.number().int().nonnegative(),
  assistedClosed: z.number().int().nonnegative(),
  walkInClosed: z.number().int().nonnegative(),
  /** Commission earned this month, in integer paise (read-only in MVP). */
  commissionEarnedPaise: z.number().int().nonnegative(),
  generatedAt: z.string(),
});
export type AgentPerformance = z.infer<typeof agentPerformanceSchema>;

/** One inspection photo (geotagged + timestamped). The private object key is
 *  never returned; only the geotag + capture time the agent recorded. */
export const inspectionPhotoSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  takenAt: z.string(),
});
export type InspectionPhotoDto = z.infer<typeof inspectionPhotoSchema>;

/** A property inspection (draft or submitted). The structured checklist fields
 *  are nullable while the inspection is a resumable DRAFT. */
export const inspectionSchema = z.object({
  id: z.string(),
  visitId: z.string(),
  listingId: z.string(),
  status: inspectionStatusSchema,
  amenities: z.record(z.string(), amenityCheckSchema).nullable(),
  roomCountListed: z.number().int().nullable(),
  roomCountActual: z.number().int().nullable(),
  cleanliness: z.record(z.string(), z.number()).nullable(),
  securityInfra: z.record(z.string(), z.boolean()).nullable(),
  discrepancies: z.string().nullable(),
  recommendation: inspectionRecommendationSchema.nullable(),
  notesForAdmin: z.string().nullable(),
  photoCount: z.number().int().nonnegative(),
  photos: z.array(inspectionPhotoSchema),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Inspection = z.infer<typeof inspectionSchema>;

/** POST /v1/agent/assisted-bookings — the pay link goes to the USER (never a
 *  payable order to the agent: the agent CANNOT pay on the user's behalf). */
export const assistedBookingResultSchema = z.object({
  bookingId: z.string(),
  status: bookingStatusSchema,
  tenantId: z.string(),
  agentChannel: agentBookingChannelSchema,
  tokenAmountPaise: z.number().int().nonnegative(),
  /** Masked destination phone the pay link was sent to (e.g. +9198xxxxxx21). */
  payLinkSentTo: z.string(),
  /** When the pay link / hold expires (2h window). */
  expiresAt: z.string().nullable(),
});
export type AssistedBookingResult = z.infer<typeof assistedBookingResultSchema>;

/** POST /v1/agent/walkin-bookings — the user scans this Razorpay QR/order on
 *  their own device; confirmation is via the verified webhook only. */
export const walkInBookingResultSchema = z.object({
  bookingId: z.string(),
  status: bookingStatusSchema,
  tenantId: z.string(),
  agentChannel: agentBookingChannelSchema,
  tokenAmountPaise: z.number().int().nonnegative(),
  razorpayOrder: z.object({
    orderId: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    keyId: z.string(),
  }),
  expiresAt: z.string().nullable(),
});
export type WalkInBookingResult = z.infer<typeof walkInBookingResultSchema>;

/** GET /v1/agent/bookings/:id — the live status of ONE booking the calling agent
 *  created (assisted or walk-in). The walk-in flow polls THIS so confirmation
 *  reflects the specific booking's webhook settlement, never an aggregate counter
 *  that any other in-scope confirmation would move. A booking the agent did not
 *  create is a 404 (no cross-agent/zone leak). */
export const agentBookingStatusSchema = z.object({
  bookingId: z.string(),
  status: bookingStatusSchema,
  agentChannel: agentBookingChannelSchema.nullable(),
  confirmedAt: z.string().nullable(),
});
export type AgentBookingStatus = z.infer<typeof agentBookingStatusSchema>;

/** An agent as ADMIN sees it after creating one. */
export const agentSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string(),
  assignedCity: z.string().nullable(),
  role: userRoleSchema,
  createdAt: z.string(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;
