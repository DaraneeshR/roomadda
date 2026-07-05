import { z } from "zod";
import {
  adSlotTypeSchema,
  agentBookingChannelSchema,
  agentVisitStatusSchema,
  amenityCheckSchema,
  bookingApprovalStatusSchema,
  bookingStatusSchema,
  broadcastAudienceSchema,
  broadcastChannelSchema,
  commissionSettlementStatusSchema,
  e164Schema,
  genderPolicySchema,
  inspectionRecommendationSchema,
  inspectionStatusSchema,
  invoiceStatusSchema,
  invoiceTypeSchema,
  kycStatusSchema,
  landingPageKindSchema,
  listingStatusSchema,
  chatMessageKindSchema,
  occupationTypeSchema,
  paymentStatusSchema,
  serviceRequestCategorySchema,
  serviceRequestPrioritySchema,
  serviceRequestStatusSchema,
  trustBadgeKindSchema,
  userGenderSchema,
  userRoleSchema,
  userStatusSchema,
  walkInPaymentModeSchema,
  weeklyMenuSchema,
} from "./contracts.js";

/**
 * Request (input) contracts — the single source of truth for every shape the
 * backend accepts at an HTTP boundary (see /CLAUDE.md). The backend modules
 * re-export these under their local names; nothing is redefined per module.
 *
 * Every schema is `.strict()` so unknown keys are rejected, and enums reuse the
 * shared zod enums in `contracts.ts` (NOT `z.nativeEnum` against Prisma) so the
 * package stays free of a backend-only `@prisma/client` dependency. The enum
 * value lists are kept in lockstep with the Prisma schema.
 */

// ---------------------------------------------------------------------------
// Pagination primitives — every cursor-paginated list endpoint caps its page.
// ---------------------------------------------------------------------------
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;
export const limitSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

/** A cursor is the id of the last row of the previous page. */
const cursorParam = z.string().uuid().optional();

// ---------------------------------------------------------------------------
// Reusable param/body primitives shared by several modules.
// ---------------------------------------------------------------------------
export const uuidParamSchema = z.object({ id: z.string().uuid() }).strict();
export const reasonBodySchema = z.object({ reason: z.string().min(1).max(500) }).strict();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const clientTypeSchema = z.enum(["web", "mobile"]);
export type ClientType = z.infer<typeof clientTypeSchema>;

/**
 * Which RoomAdda app a sign-in is coming from. The server uses it to reject a
 * login whose role the app doesn't serve (tenant app = TENANT; host_agent app =
 * HOST/AGENT). Optional for backward compatibility; when omitted, no app gate is
 * applied server-side.
 */
export const appAudienceSchema = z.enum(["tenant", "host_agent"]);
export type AppAudience = z.infer<typeof appAudienceSchema>;

export const otpRequestSchema = z.object({ phone: e164Schema }).strict();

export const otpVerifySchema = z
  .object({
    phone: e164Schema,
    code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
    client: clientTypeSchema,
    appAudience: appAudienceSchema.optional(),
  })
  .strict();

export const refreshSchema = z
  .object({
    client: clientTypeSchema,
    // Required for mobile clients; web clients send it via httpOnly cookie.
    refreshToken: z.string().min(1).optional(),
  })
  .strict();

export const logoutSchema = z.object({ refreshToken: z.string().min(1).optional() }).strict();

export const roleChangeBodySchema = z.object({ role: userRoleSchema }).strict();

// Password auth for §15.7 back-office TEAM logins (email + password), distinct
// from the phone-OTP flow the apps use. A password must be reasonably strong; the
// server never returns or logs it.
export const passwordPolicySchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200);

/** POST /v1/auth/password/login — email + password. When the account still has a
 *  temp password the server returns a change challenge (no session issued). */
export const passwordLoginSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1).max(200),
    client: clientTypeSchema,
  })
  .strict();
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;

/** POST /v1/auth/password/change — set a new password using the current one. Used
 *  for the forced first-login change (proves knowledge of the temp password) and
 *  for ordinary rotations. Issues a fresh session on success. */
export const passwordChangeSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordPolicySchema,
    client: clientTypeSchema,
  })
  .strict()
  .refine((b) => b.currentPassword !== b.newPassword, {
    message: "New password must differ from the current one",
    path: ["newPassword"],
  });
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
const paise = z.number().int().nonnegative();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const pincode = z.string().regex(/^\d{6}$/, "pincode must be 6 digits");
const amenities = z.array(z.string().min(1).max(60)).max(50);

export const createListingSchema = z
  .object({
    alias: z.string().min(1).max(120),
    actualName: z.string().min(1).max(200),
    areaLabel: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    pincode,
    fullAddress: z.string().min(1).max(500),
    latitude,
    longitude,
    gender: genderPolicySchema.default("COED"),
    amenities: amenities.default([]),
    // Optional create-step fields (meals, house rules, token + booking-type). All
    // editable later via the host listing edit endpoint.
    houseRules: z.array(z.string().min(1).max(200)).max(50).default([]),
    mealsOffered: z.boolean().default(false),
    mealChargesPaise: paise.optional(),
    tokenAmountPaise: paise.positive().optional(),
    instantBook: z.boolean().default(true),
  })
  .strict();

export const updateListingSchema = z
  .object({
    alias: z.string().min(1).max(120),
    actualName: z.string().min(1).max(200),
    areaLabel: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    pincode,
    fullAddress: z.string().min(1).max(500),
    latitude,
    longitude,
    gender: genderPolicySchema,
    amenities,
    status: listingStatusSchema,
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "no fields to update" });

export const createRoomSchema = z
  .object({
    name: z.string().min(1).max(120),
    floor: z.number().int().min(-5).max(200).optional(),
    sharingType: z.number().int().min(1).max(20),
    monthlyRentPaise: paise,
    depositPaise: paise.default(0),
  })
  .strict();

export const createBedSchema = z
  .object({
    label: z.string().min(1).max(40),
    monthlyRentPaise: paise.optional(),
  })
  .strict();

export const createPhotoSchema = z
  .object({
    url: z.string().url().max(2000),
    isPrimary: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

/** Request a presigned PUT for one listing photo captured on-device (jpeg/png).
 *  The client PUTs the bytes to the public bucket, then attaches the returned
 *  publicUrl via the existing createPhotoSchema path. */
export const listingPhotoUploadUrlSchema = z
  .object({ contentType: z.enum(["image/jpeg", "image/png"]) })
  .strict();
export type ListingPhotoUploadUrlInput = z.infer<typeof listingPhotoUploadUrlSchema>;

export const roomParamSchema = z.object({ id: z.string().uuid(), roomId: z.string().uuid() }).strict();

// --- Maintenance / service requests -----------------------------------------
/** Raise a ticket against the caller's active stay (the server resolves which). */
export const createServiceRequestSchema = z
  .object({
    category: serviceRequestCategorySchema,
    description: z.string().min(1).max(2000),
    priority: serviceRequestPrioritySchema.default("NORMAL"),
    // Up to 3 private object keys from the photo-url endpoint (ownership checked).
    photoRefs: z.array(z.string().min(1).max(1024)).max(3).default([]),
  })
  .strict();
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestSchema>;

/** A follow-up comment on a request (tenants can comment, never delete). */
export const serviceRequestCommentInputSchema = z.object({ body: z.string().min(1).max(2000) }).strict();
export type ServiceRequestCommentInput = z.infer<typeof serviceRequestCommentInputSchema>;

/** 1–5 satisfaction rating, accepted only once a request is RESOLVED. */
export const serviceRequestRatingSchema = z.object({ rating: z.number().int().min(1).max(5) }).strict();
export type ServiceRequestRatingInput = z.infer<typeof serviceRequestRatingSchema>;

/** Presigned PUT for one request photo (jpeg/png only). */
export const serviceRequestPhotoUrlSchema = z
  .object({ contentType: z.enum(["image/jpeg", "image/png"]) })
  .strict();
export type ServiceRequestPhotoUrlInput = z.infer<typeof serviceRequestPhotoUrlSchema>;

export const listServiceRequestsQuerySchema = z
  .object({ status: serviceRequestStatusSchema.optional(), cursor: cursorParam, limit: limitSchema })
  .strict();
export type ListServiceRequestsQuery = z.infer<typeof listServiceRequestsQuerySchema>;

/** Admin oversight query — filter by status / priority / escalation. */
export const adminServiceRequestsQuerySchema = z
  .object({
    status: serviceRequestStatusSchema.optional(),
    priority: serviceRequestPrioritySchema.optional(),
    // Query strings are text; accept only the literal booleans.
    escalated: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type AdminServiceRequestsQuery = z.infer<typeof adminServiceRequestsQuerySchema>;

// --- Leave notice -----------------------------------------------------------
/** Serve notice to vacate. The notice-period / 3-day-lock rules are enforced
 *  in the service against the caller's active stay. */
export const createLeaveNoticeSchema = z.object({ moveOutDate: z.coerce.date() }).strict();
export type CreateLeaveNoticeInput = z.infer<typeof createLeaveNoticeSchema>;

// --- Safety: trusted contacts + SOS -----------------------------------------
export const createTrustedContactSchema = z
  .object({ name: z.string().min(1).max(120), phone: e164Schema })
  .strict();
export type CreateTrustedContactInput = z.infer<typeof createTrustedContactSchema>;

/** Trigger SOS. Coordinates are OPTIONAL — the alert still fires (admin + SMS)
 *  when GPS is unavailable, so it works on poor connectivity / denied location. */
export const sosSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyMeters: z.number().nonnegative().optional(),
  })
  .strict();
export type SosInput = z.infer<typeof sosSchema>;

// --- Chat (tenant <-> host) -------------------------------------------------
/** Send a message: TEXT carries `text`, PHOTO carries `photoRef` (from photo-url).
 *  The NO-phone-numbers rule is enforced in the service (clear, specific error). */
export const sendChatMessageSchema = z
  .object({
    kind: chatMessageKindSchema.default("TEXT"),
    text: z.string().min(1).max(2000).optional(),
    photoRef: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "TEXT" && (!v.text || v.photoRef)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TEXT requires `text` and no `photoRef`" });
    }
    if (v.kind === "PHOTO" && (!v.photoRef || v.text)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PHOTO requires `photoRef` and no `text`" });
    }
  });
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const chatTypingSchema = z.object({ isTyping: z.boolean() }).strict();
export type ChatTypingInput = z.infer<typeof chatTypingSchema>;

export const reportChatMessageSchema = z.object({ reason: z.string().min(1).max(500).optional() }).strict();
export type ReportChatMessageInput = z.infer<typeof reportChatMessageSchema>;

export const chatPhotoUrlSchema = z.object({ contentType: z.enum(["image/jpeg", "image/png"]) }).strict();
export type ChatPhotoUrlInput = z.infer<typeof chatPhotoUrlSchema>;

export const listChatMessagesQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

/** Register an FCM device token for push (chat + future notifications). */
export const registerDeviceSchema = z
  .object({ token: z.string().min(1).max(4096), platform: z.enum(["android", "ios"]).optional() })
  .strict();
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

// --- Meal menu --------------------------------------------------------------
/** Read the menu for `date` (default today) plus the following day. */
export const menuQuerySchema = z.object({ date: z.coerce.date().optional() }).strict();
export type MenuQuery = z.infer<typeof menuQuerySchema>;

/** One slot in a menu upsert: a dish, or explicitly not served. Omit to leave empty. */
const mealSlotInputSchema = z
  .object({
    text: z.string().min(1).max(500).nullable().optional(),
    notAvailable: z.boolean().optional(),
  })
  .strict();

/** Minimal host upsert of a day's menu (host-update UI lands in the host phase). */
export const upsertMealMenuSchema = z
  .object({
    date: z.coerce.date(),
    breakfast: mealSlotInputSchema.optional(),
    lunch: mealSlotInputSchema.optional(),
    dinner: mealSlotInputSchema.optional(),
  })
  .strict();
export type UpsertMealMenuInput = z.infer<typeof upsertMealMenuSchema>;

export const listFiltersSchema = z
  .object({
    city: z.string().min(1).max(120).optional(),
    area: z.string().min(1).max(120).optional(),
    gender: genderPolicySchema.optional(),
    sharingType: z.coerce.number().int().min(1).max(20).optional(),
    minRentPaise: z.coerce.number().int().nonnegative().optional(),
    maxRentPaise: z.coerce.number().int().nonnegative().optional(),
    // Move-in date: restricts to listings that currently have availability (>=1
    // AVAILABLE bed). True date-aware availability needs move-out scheduling,
    // which isn't modelled yet — this is the closest serviceable behaviour.
    moveInDate: z.coerce.date().optional(),
    // Trust-badge filter: only listings that currently hold this active badge.
    // INSTANT_BOOK resolves to "host-enabled + a live AVAILABLE bed" (derived),
    // every other kind to a live, non-suspended, unexpired earned badge.
    badge: trustBadgeKindSchema.optional(),
    amenities: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
          : undefined,
      ),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();

export const nearbyQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusM: z.coerce.number().int().min(1).max(10_000),
    cursor: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateBedInput = z.infer<typeof createBedSchema>;
export type CreatePhotoInput = z.infer<typeof createPhotoSchema>;
export type ListFilters = z.infer<typeof listFiltersSchema>;
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;

// --- Area insights ----------------------------------------------------------
/** Path param for GET /v1/areas/:area/insights — the (URL-decoded) area label. */
export const areaParamSchema = z.object({ area: z.string().min(1).max(120) }).strict();
export type AreaParam = z.infer<typeof areaParamSchema>;

/** Optional `city` disambiguates a same-named area across cities (e.g. "Sector 5"). */
export const areaInsightsQuerySchema = z
  .object({ city: z.string().min(1).max(120).optional() })
  .strict();
export type AreaInsightsQuery = z.infer<typeof areaInsightsQuerySchema>;

// ---------------------------------------------------------------------------
// Booking + token payment
// ---------------------------------------------------------------------------
export const listBookingsQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

export const createBookingSchema = z
  .object({
    // Exactly one of bedId (direct) or roomId (server picks an available bed —
    // discovery is masked and never exposes bed ids).
    bedId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    moveInDate: z.coerce.date().optional(),
    mealPlan: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.bedId) !== Boolean(b.roomId), {
    message: "exactly one of bedId or roomId is required",
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/** Cancel a booking (refund is applied per policy, server-side). */
export const cancelBookingSchema = z.object({ reason: z.string().min(1).max(500).optional() }).strict();
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

// ---------------------------------------------------------------------------
// Recurring monthly rent. The pay endpoint takes NO amount — the server always
// orders the FULL invoice amount, so a partial payment cannot be requested.
// ---------------------------------------------------------------------------
export const listRentQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();
export type ListRentQuery = z.infer<typeof listRentQuerySchema>;

export const createPaymentSchema = z
  .object({
    method: z.enum(["ONLINE", "CASH", "SPLIT"]),
    onlinePaise: z.number().int().nonnegative(),
    cashPaise: z.number().int().nonnegative(),
    // Required when there is a cash leg; must reference an AGENT (checked in service).
    agentId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === "ONLINE" && (v.onlinePaise <= 0 || v.cashPaise !== 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ONLINE requires onlinePaise > 0 and cashPaise == 0" });
    }
    if (v.method === "CASH" && (v.cashPaise <= 0 || v.onlinePaise !== 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CASH requires cashPaise > 0 and onlinePaise == 0" });
    }
    if (v.method === "SPLIT" && (v.onlinePaise <= 0 || v.cashPaise <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SPLIT requires both onlinePaise > 0 and cashPaise > 0" });
    }
    if (v.cashPaise > 0 && !v.agentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agentId"], message: "agentId is required for a cash leg" });
    }
  });
export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;

// ---------------------------------------------------------------------------
// KYC (just-in-time identity verification). The tenant uploads three documents
// to a PRIVATE bucket via short-lived presigned URLs, then submits the object
// keys here — only keys (never files) reach the API/DB. Content type is
// constrained to images + PDF and validated server-side.
// ---------------------------------------------------------------------------
export const kycMimeSchema = z.enum(["image/jpeg", "image/png", "application/pdf"]);
export type KycMime = z.infer<typeof kycMimeSchema>;

export const kycSlotSchema = z.enum(["aadhaar_front", "aadhaar_back", "supporting"]);
export type KycSlot = z.infer<typeof kycSlotSchema>;

export const kycSupportingDocTypeSchema = z.enum(["STUDENT_ID", "OFFICE_ID", "OFFER_LETTER"]);
export type KycSupportingDocType = z.infer<typeof kycSupportingDocTypeSchema>;

/** Request a short-lived presigned PUT URL for one document slot. */
export const kycUploadUrlSchema = z.object({ slot: kycSlotSchema, contentType: kycMimeSchema }).strict();
export type KycUploadUrlInput = z.infer<typeof kycUploadUrlSchema>;

/** One uploaded document: the private object key + its declared content type. */
const kycDocRefShape = { key: z.string().min(1).max(512), contentType: kycMimeSchema };

/** Submit the three uploaded documents for review (Aadhaar front/back + one ID). */
export const kycSubmitSchema = z
  .object({
    aadhaarFront: z.object(kycDocRefShape).strict(),
    aadhaarBack: z.object(kycDocRefShape).strict(),
    supporting: z.object({ ...kycDocRefShape, docType: kycSupportingDocTypeSchema }).strict(),
  })
  .strict();
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

// ---------------------------------------------------------------------------
// User profile (self-service). PATCH /v1/me edits ONLY the caller's own row —
// never an :id. `college`/`company` are nullable so they can be cleared.
// ---------------------------------------------------------------------------
export const updateProfileSchema = z
  .object({
    fullName: z.string().min(1).max(120).optional(),
    gender: userGenderSchema.optional(),
    dateOfBirth: z.coerce.date().optional(),
    occupationType: occupationTypeSchema.optional(),
    college: z.string().min(1).max(200).nullable().optional(),
    company: z.string().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "no fields to update" });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------
// Wishlist (per-user saved listings; shared across the app + web account).
// ---------------------------------------------------------------------------
export const wishlistParamSchema = z.object({ listingId: z.string().uuid() }).strict();
export const wishlistQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();
export type WishlistQuery = z.infer<typeof wishlistQuerySchema>;

// ---------------------------------------------------------------------------
// Reviews & ratings. A tenant reviews a listing FROM a specific eligible stay
// (`bookingId`), so the review is bound to that booking — one review per
// booking, enforced server-side. The stay's eligibility (owned by the caller,
// on this listing, CONFIRMED/COMPLETED) is checked in the service.
// ---------------------------------------------------------------------------
export const createReviewSchema = z
  .object({
    /** The caller's eligible stay this review is written from. */
    bookingId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    /** Optional free-text; a star-only review omits it. */
    text: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/** The host's public reply to a review (host must own the listing). */
export const hostReviewResponseSchema = z.object({ text: z.string().min(1).max(2000) }).strict();
export type HostReviewResponseInput = z.infer<typeof hostReviewResponseSchema>;

/** GET /v1/listings/:id/reviews — cursor-paginated, newest first. */
export const listReviewsQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

// ---------------------------------------------------------------------------
// Social proof — "viewing now" presence heartbeat. The client pings this on a
// short interval while a listing is open (web + app). `sessionId` is a stable
// per-device/tab id so the SAME viewer is counted ONCE (distinct sessions, not
// refreshes); an authenticated caller is deduped by their user id server-side,
// so the field is optional but required for anonymous viewers to be counted.
// ---------------------------------------------------------------------------
export const viewingHeartbeatSchema = z
  .object({ sessionId: z.string().uuid().optional() })
  .strict();
export type ViewingHeartbeatInput = z.infer<typeof viewingHeartbeatSchema>;

// ---------------------------------------------------------------------------
// Trust badges — admin actions. An admin may GRANT only the paid FEATURED badge
// (never a rule badge — the service rejects any other kind), and may SUSPEND a
// rule badge with a logged reason (hides it without deleting the audit record).
// ---------------------------------------------------------------------------
export const badgeKindParamSchema = z.object({ kind: trustBadgeKindSchema }).strict();

/** Path params for a specific listing↔badge link (`/listings/:id/badges/:kind`). */
export const listingBadgeParamSchema = z
  .object({ id: z.string().uuid(), kind: trustBadgeKindSchema })
  .strict();

/** Grant a badge. The service permits ONLY kind === "FEATURED". The paid
 *  placement is time-boxed by EITHER an explicit `startDate`/`endDate` window
 *  (scheduling ahead) OR `durationDays` from now (default 30) when no window is
 *  given. `startDate` must be before `endDate`. */
export const grantBadgeSchema = z
  .object({
    kind: trustBadgeKindSchema,
    durationDays: z.coerce.number().int().min(1).max(365).default(30),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => (v.startDate && v.endDate ? v.startDate < v.endDate : true), {
    message: "startDate must be before endDate",
    path: ["endDate"],
  })
  .refine((v) => (v.endDate ? !!v.startDate : true), {
    message: "startDate is required when endDate is set",
    path: ["startDate"],
  });
export type GrantBadgeInput = z.infer<typeof grantBadgeSchema>;

/** Suspend a rule badge (logged reason; the badge is retained but hidden). */
export const suspendBadgeSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export type SuspendBadgeInput = z.infer<typeof suspendBadgeSchema>;

// ---------------------------------------------------------------------------
// Advertising (ad slots)
// ---------------------------------------------------------------------------
export const slotTypeParamSchema = z.object({ slotType: adSlotTypeSchema }).strict();

export const putPricingSchema = z
  .object({ pricePaise: z.number().int().positive(), isActive: z.boolean().default(true) })
  .strict();

export const createAdSchema = z
  .object({
    listingId: z.string().uuid(),
    slotType: adSlotTypeSchema,
    startDate: z.coerce
      .date()
      .refine((d) => d.getTime() >= Date.now() - 24 * 60 * 60 * 1000, "startDate cannot be in the past"),
  })
  .strict();

export const featuredQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(20).default(10) })
  .strict();

export const pendingAdsQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();

export type PutPricingInput = z.infer<typeof putPricingSchema>;
export type CreateAdInput = z.infer<typeof createAdSchema>;

// ---------------------------------------------------------------------------
// Admin surface queries
// ---------------------------------------------------------------------------
export const kycQuerySchema = z
  .object({ status: kycStatusSchema.default("PENDING"), cursor: cursorParam, limit: limitSchema })
  .strict();

export const listingReviewQuerySchema = z
  .object({ status: listingStatusSchema.default("PENDING_REVIEW"), cursor: cursorParam, limit: limitSchema })
  .strict();

export const cashQuerySchema = z.object({ cursor: cursorParam, limit: limitSchema }).strict();

export const bookingSearchSchema = z
  .object({
    status: bookingStatusSchema.optional(),
    tenantId: z.string().uuid().optional(),
    listingId: z.string().uuid().optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();

export const paymentSearchSchema = z
  .object({
    status: paymentStatusSchema.optional(),
    bookingId: z.string().uuid().optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();

/** Admin property-inspection review queue — defaults to SUBMITTED (awaiting review). */
export const adminInspectionsQuerySchema = z
  .object({ status: inspectionStatusSchema.default("SUBMITTED"), cursor: cursorParam, limit: limitSchema })
  .strict();
export type AdminInspectionsQuery = z.infer<typeof adminInspectionsQuerySchema>;

// ---------------------------------------------------------------------------
// Roomie assistant — untrusted public boundary. The message is length-bounded
// BEFORE any work and control characters are stripped so they cannot be
// smuggled into the prompt.
// ---------------------------------------------------------------------------
export const MAX_MESSAGE_CHARS = 1000;

// Match C0 controls (except tab and newline), DEL, and C1 controls. Built from
// an ASCII string so the source file itself carries no literal control bytes.
// eslint-disable-next-line no-control-regex -- intentionally matching control chars
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");

/**
 * Remove control characters, keeping ordinary whitespace and normalising CRLF.
 * Run AFTER the length check so an oversized payload is rejected rather than
 * silently shrunk.
 */
function stripControlChars(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

const messageSchema = z
  .string()
  .min(1, "message must not be empty")
  .max(MAX_MESSAGE_CHARS, `message must be at most ${MAX_MESSAGE_CHARS} characters`)
  .transform(stripControlChars)
  // A message that was only control chars/whitespace is empty after stripping.
  .refine((value) => value.length > 0, "message must not be empty");

export const roomieRequestSchema = z
  .object({
    message: messageSchema,
    // Opaque, server-issued session id (UUID). Optional on the first turn.
    sessionId: z.string().uuid().optional(),
  })
  .strict();

export type RoomieRequest = z.infer<typeof roomieRequestSchema>;

// ---------------------------------------------------------------------------
// HOST SURFACE request schemas (consumed by the host app + the web host portal).
// Every host route is ownership-scoped server-side; these only validate shape.
// ---------------------------------------------------------------------------
const aadhaarNumber = z.string().regex(/^\d{12}$/, "Aadhaar number must be 12 digits");

/** Edit a listing's host-managed fields. An address change (fullAddress / pincode
 *  / latitude / longitude) re-queues the listing for approval; minor edits go
 *  live immediately — the server classifies which. At least one field required. */
export const updateHostListingSchema = z
  .object({
    alias: z.string().min(1).max(120),
    actualName: z.string().min(1).max(200),
    areaLabel: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    pincode,
    fullAddress: z.string().min(1).max(500),
    latitude,
    longitude,
    gender: genderPolicySchema,
    amenities,
    houseRules: z.array(z.string().min(1).max(200)).max(50),
    mealsOffered: z.boolean(),
    mealChargesPaise: paise.nullable(),
    tokenAmountPaise: paise.positive().nullable(),
    instantBook: z.boolean(),
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "no fields to update" });
export type UpdateHostListingInput = z.infer<typeof updateHostListingSchema>;

/** Edit a room. A monthly-rent change greater than 20% re-queues the parent
 *  listing for approval (the server classifies); other edits go live. */
export const updateHostRoomSchema = z
  .object({
    name: z.string().min(1).max(120),
    floor: z.number().int().min(-5).max(200).nullable(),
    sharingType: z.number().int().min(1).max(20),
    monthlyRentPaise: paise,
    depositPaise: paise,
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "no fields to update" });
export type UpdateHostRoomInput = z.infer<typeof updateHostRoomSchema>;

/** Manual walk-in inventory adjust: BLOCK marks beds occupied (flagged distinctly
 *  from platform bookings), UNBLOCK frees previously blocked beds. */
export const adjustInventorySchema = z
  .object({
    action: z.enum(["BLOCK", "UNBLOCK"]),
    count: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

/** Record a walk-in tenant. The Aadhaar number is typed (never an uploaded doc)
 *  and stored for the host's record only — it is never returned in full. */
export const createWalkInSchema = z
  .object({
    roomId: z.string().uuid(),
    name: z.string().min(1).max(120),
    phone: e164Schema,
    aadhaarNumber,
    moveInDate: z.coerce.date(),
    monthlyRentPaise: paise.positive(),
    depositPaise: paise.default(0),
    paymentMode: walkInPaymentModeSchema.default("CASH"),
  })
  .strict();
export type CreateWalkInInput = z.infer<typeof createWalkInSchema>;

export const walkInParamSchema = z.object({ walkInId: z.string().uuid() }).strict();
export const walkInQuerySchema = z
  .object({
    // includeCheckedOut surfaces past walk-ins in the roster; default current only.
    includeCheckedOut: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type WalkInQuery = z.infer<typeof walkInQuerySchema>;

/** Host roster query — `scope` selects current (default) or past tenants. */
export const rosterQuerySchema = z
  .object({ scope: z.enum(["current", "past"]).default("current"), cursor: cursorParam, limit: limitSchema })
  .strict();
export type RosterQuery = z.infer<typeof rosterQuerySchema>;

/** Host's incoming booking-request feed. `status` defaults to actionable requests. */
export const hostBookingRequestsQuerySchema = z
  .object({
    status: bookingStatusSchema.optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type HostBookingRequestsQuery = z.infer<typeof hostBookingRequestsQuerySchema>;

/** Host service queue query — filter by status; newest/escalated first. */
export const hostServiceQuerySchema = z
  .object({ status: serviceRequestStatusSchema.optional(), cursor: cursorParam, limit: limitSchema })
  .strict();
export type HostServiceQuery = z.infer<typeof hostServiceQuerySchema>;

/** A tenant-visible note the host adds to a service request. */
export const serviceNoteSchema = z.object({ note: z.string().min(1).max(2000) }).strict();
export type ServiceNoteInput = z.infer<typeof serviceNoteSchema>;

/** A broadcast to all current tenants of a property (max 280 chars, 3/day). */
export const broadcastSchema = z.object({ body: z.string().min(1).max(280) }).strict();
export type BroadcastInput = z.infer<typeof broadcastSchema>;

/** Save (create/replace) a named weekly meal template. */
export const createMealTemplateSchema = z
  .object({ name: z.string().min(1).max(80), days: weeklyMenuSchema })
  .strict();
export type CreateMealTemplateInput = z.infer<typeof createMealTemplateSchema>;

export const mealTemplateParamSchema = z.object({ templateId: z.string().uuid() }).strict();
/** Route params for a template nested under a listing: { id, templateId }. */
export const listingTemplateParamSchema = z
  .object({ id: z.string().uuid(), templateId: z.string().uuid() })
  .strict();

/** Apply a saved template to a week, filling 7 days of menu starting weekStartDate. */
export const applyMealTemplateSchema = z
  .object({ templateId: z.string().uuid(), weekStartDate: z.coerce.date() })
  .strict();
export type ApplyMealTemplateInput = z.infer<typeof applyMealTemplateSchema>;

// ---------------------------------------------------------------------------
// AGENT SURFACE request schemas (the §9.1 zone-access invariant is enforced
// server-side on every route; these only validate shape). Agents are created by
// ADMIN only — there is no self-register schema here.
// ---------------------------------------------------------------------------

/** ADMIN creates a zone-scoped agent (no self-register). `assignedCity` is the
 *  §9.1 scope key. */
export const createAgentSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    phone: e164Schema,
    assignedCity: z.string().min(1).max(120),
    email: z.string().email().max(200).optional(),
  })
  .strict();
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

/** Agent visit feed query — optional status filter, cursor-paginated. */
export const agentVisitsQuerySchema = z
  .object({ status: agentVisitStatusSchema.optional(), cursor: cursorParam, limit: limitSchema })
  .strict();
export type AgentVisitsQuery = z.infer<typeof agentVisitsQuerySchema>;

export const visitIdParamSchema = z.object({ id: z.string().uuid() }).strict();

/** `:id` path param for GET /v1/agent/bookings/:id (an agent-attributed booking). */
export const agentBookingIdParamSchema = z.object({ id: z.string().uuid() }).strict();

/** GPS check-in on a visit. The point is validated against the property geography
 *  (within 200m) server-side; an out-of-range point is still recorded (flagged). */
export const agentCheckInSchema = z
  .object({
    lat: latitude,
    lng: longitude,
    accuracyMeters: z.number().nonnegative().optional(),
  })
  .strict();
export type AgentCheckInInput = z.infer<typeof agentCheckInSchema>;

/** Per-area maps in the inspection checklist (bounded key counts). */
const amenitiesCheckMap = z
  .record(z.string().min(1).max(60), amenityCheckSchema)
  .refine((m) => Object.keys(m).length <= 100, { message: "too many amenities" });
const cleanlinessMap = z
  .record(z.string().min(1).max(60), z.number().int().min(1).max(5))
  .refine((m) => Object.keys(m).length <= 50, { message: "too many areas" });
const securityInfraMap = z
  .record(z.string().min(1).max(60), z.boolean())
  .refine((m) => Object.keys(m).length <= 50, { message: "too many security items" });

/** Partial-save the inspection checklist (DRAFT). Every field is optional so the
 *  agent can save/resume on the same visit; at least one field is required. */
export const inspectionDraftSchema = z
  .object({
    amenities: amenitiesCheckMap.optional(),
    roomCountListed: z.number().int().min(0).max(1000).optional(),
    roomCountActual: z.number().int().min(0).max(1000).optional(),
    cleanliness: cleanlinessMap.optional(),
    securityInfra: securityInfraMap.optional(),
    discrepancies: z.string().max(5000).nullable().optional(),
    recommendation: inspectionRecommendationSchema.optional(),
    notesForAdmin: z.string().max(5000).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "no fields to save" });
export type InspectionDraftInput = z.infer<typeof inspectionDraftSchema>;

/** Presigned PUT for one inspection photo (jpeg/png only). */
export const inspectionPhotoUrlSchema = z
  .object({ contentType: z.enum(["image/jpeg", "image/png"]) })
  .strict();
export type InspectionPhotoUrlInput = z.infer<typeof inspectionPhotoUrlSchema>;

/** Attach one geotagged + timestamped photo (after uploading to its object key). */
export const addInspectionPhotoSchema = z
  .object({
    key: z.string().min(1).max(1024),
    lat: latitude,
    lng: longitude,
    takenAt: z.coerce.date(),
  })
  .strict();
export type AddInspectionPhotoInput = z.infer<typeof addInspectionPhotoSchema>;

/** Agent-created booking (assisted OR walk-in): the agent enters the tenant's
 *  name + mobile and a room/bed. The agent NEVER pays — the user pays from their
 *  own device (assisted = SMS link; walk-in = scans a QR). */
export const agentBookingSchema = z
  .object({
    tenantName: z.string().min(1).max(120),
    tenantPhone: e164Schema,
    bedId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    moveInDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((b) => Boolean(b.bedId) !== Boolean(b.roomId), {
    message: "exactly one of bedId or roomId is required",
  });
export type AgentBookingInput = z.infer<typeof agentBookingSchema>;

// ---------------------------------------------------------------------------
// Admin console (webadmin §7) — request contracts. Every one is ADMIN-only at
// the route; the mutating ones are audited server-side. `.strict()` throughout.
// ---------------------------------------------------------------------------

// ---- Service-request oversight ----
/** Admin marks a request RESOLVED on the host's behalf (mandatory reason logged). */
export const adminResolveServiceRequestSchema = z
  .object({ reason: z.string().min(1).max(500) })
  .strict();
export type AdminResolveServiceRequestInput = z.infer<typeof adminResolveServiceRequestSchema>;

/** Admin contacts the host about a request WITHOUT exposing the host's phone —
 *  the message is delivered to the host's queue as an admin note. */
export const adminContactHostSchema = z.object({ message: z.string().min(1).max(2000) }).strict();
export type AdminContactHostInput = z.infer<typeof adminContactHostSchema>;

/** Flag a host for poor response (optionally tied to the triggering request). */
export const flagHostSchema = z
  .object({
    reason: z.string().min(1).max(500),
    serviceRequestId: z.string().uuid().optional(),
  })
  .strict();
export type FlagHostInput = z.infer<typeof flagHostSchema>;

// ---- Host & agent management ----
export const adminHostsQuerySchema = z
  .object({
    status: userStatusSchema.optional(),
    // Substring match on name/phone (case-insensitive, server-side).
    search: z.string().trim().min(1).max(120).optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type AdminHostsQuery = z.infer<typeof adminHostsQuerySchema>;

export const adminAgentsQuerySchema = z
  .object({
    status: userStatusSchema.optional(),
    city: z.string().trim().min(1).max(120).optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type AdminAgentsQuery = z.infer<typeof adminAgentsQuerySchema>;

/** Suspend/ban a user (reason mandatory) or reinstate (reason ignored). */
export const moderateUserSchema = z
  .object({
    action: z.enum(["SUSPEND", "BAN", "REINSTATE"]),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.action === "REINSTATE" || !!v.reason, {
    message: "reason is required to suspend or ban",
    path: ["reason"],
  });
export type ModerateUserInput = z.infer<typeof moderateUserSchema>;

/** Update an agent's zone (territory). */
export const updateAgentTerritorySchema = z
  .object({ assignedCity: z.string().min(1).max(120) })
  .strict();
export type UpdateAgentTerritoryInput = z.infer<typeof updateAgentTerritorySchema>;

/** Admin schedules a property-inspection visit for an agent. */
export const assignVisitSchema = z
  .object({
    listingId: z.string().uuid(),
    agentId: z.string().uuid(),
    scheduledAt: z.coerce.date(),
  })
  .strict();
export type AssignVisitInput = z.infer<typeof assignVisitSchema>;

// ---- CMS + SEO ----
const optionalMeta = z.string().max(300).optional();

export const blogPostInputSchema = z
  .object({
    slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
    title: z.string().min(1).max(300),
    metaTitle: optionalMeta,
    metaDescription: optionalMeta,
    excerpt: z.string().max(500).optional(),
    body: z.string().max(100_000).optional(),
    published: z.boolean().optional(),
  })
  .strict();
export type BlogPostInput = z.infer<typeof blogPostInputSchema>;

/** Partial update — every field optional; slug cannot be changed here. */
export const blogPostUpdateSchema = blogPostInputSchema.partial().omit({ slug: true }).strict();
export type BlogPostUpdateInput = z.infer<typeof blogPostUpdateSchema>;

export const faqInputSchema = z
  .object({
    question: z.string().min(1).max(500),
    answer: z.string().min(1).max(5000),
    category: z.string().max(120).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    published: z.boolean().optional(),
  })
  .strict();
export type FaqInput = z.infer<typeof faqInputSchema>;
export const faqUpdateSchema = faqInputSchema.partial().strict();
export type FaqUpdateInput = z.infer<typeof faqUpdateSchema>;

export const testimonialInputSchema = z
  .object({
    authorName: z.string().min(1).max(160),
    authorRole: z.string().max(160).optional(),
    quote: z.string().min(1).max(2000),
    avatarUrl: z.string().url().max(1000).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    published: z.boolean().optional(),
  })
  .strict();
export type TestimonialInput = z.infer<typeof testimonialInputSchema>;
export const testimonialUpdateSchema = testimonialInputSchema.partial().strict();
export type TestimonialUpdateInput = z.infer<typeof testimonialUpdateSchema>;

export const landingPageInputSchema = z
  .object({
    kind: landingPageKindSchema,
    slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
    heading: z.string().min(1).max(300),
    bodyCopy: z.string().max(100_000).optional(),
    metaTitle: optionalMeta,
    metaDescription: optionalMeta,
    ogImageUrl: z.string().url().max(1000).optional(),
    keywords: z.array(z.string().min(1).max(80)).max(50).optional(),
    published: z.boolean().optional(),
  })
  .strict();
export type LandingPageInput = z.infer<typeof landingPageInputSchema>;

/** Partial update — kind + slug are the identity and cannot change here. */
export const landingPageUpdateSchema = landingPageInputSchema
  .partial()
  .omit({ kind: true, slug: true })
  .strict();
export type LandingPageUpdateInput = z.infer<typeof landingPageUpdateSchema>;

/** Replace the homepage featured ordering with this exact ordered list. */
export const homepageOrderSchema = z
  .object({ listingIds: z.array(z.string().uuid()).max(50) })
  .strict();
export type HomepageOrderInput = z.infer<typeof homepageOrderSchema>;

/** Public content lookups by human key. */
export const slugParamSchema = z.object({ slug: z.string().min(1).max(160) }).strict();
export const landingPageParamSchema = z
  .object({ kind: landingPageKindSchema, slug: z.string().min(1).max(160) })
  .strict();

/** Generic published/sort listing query for CMS collections. */
export const cmsListQuerySchema = z
  .object({
    published: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type CmsListQuery = z.infer<typeof cmsListQuerySchema>;

// ---- Notifications & WhatsApp broadcast ----
/** Compose a broadcast to a segment; schedule now (omit scheduledAt) or later. */
export const createBroadcastSchema = z
  .object({
    channel: broadcastChannelSchema,
    audience: broadcastAudienceSchema,
    // Required only for CITY / BEHAVIOUR audiences (validated below).
    audienceValue: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    deepLink: z.string().max(1000).optional(),
    scheduledAt: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (v) => (v.audience === "CITY" || v.audience === "BEHAVIOUR" ? !!v.audienceValue : true),
    { message: "audienceValue is required for CITY/BEHAVIOUR audiences", path: ["audienceValue"] },
  );
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const broadcastsQuerySchema = z
  .object({
    status: z.enum(["SCHEDULED", "SENT", "CANCELLED"]).optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type BroadcastsQuery = z.infer<typeof broadcastsQuerySchema>;

// ---------------------------------------------------------------------------
// ERP — commission ledger (§15). The global finance filter (§15.3): financial
// year, quarter, month, property (listingId) and agent — set once, applied
// everywhere. `financialYear` is the Indian FY start year (2026 = 1 Apr 2026 →
// 31 Mar 2027). `quarter` (1–4) and `month` (calendar 1–12) are mutually
// exclusive and resolved WITHIN the chosen FY; when none is given the server
// defaults to the current FY (so the query is always period-bounded).
// ---------------------------------------------------------------------------
export const erpCommissionQuerySchema = z
  .object({
    financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
    quarter: z.coerce.number().int().min(1).max(4).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    listingId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    status: commissionSettlementStatusSchema.optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict()
  .refine((q) => !(q.quarter !== undefined && q.month !== undefined), {
    message: "provide quarter or month, not both",
    path: ["month"],
  });
export type ErpCommissionQuery = z.infer<typeof erpCommissionQuerySchema>;

/** Path param for the single mark-received route. */
export const bookingIdParamSchema = z.object({ bookingId: z.string().uuid() }).strict();

/** Body for marking ONE booking's commission received. `paidToPgPaise` records
 *  the payout made to the PG owner at settlement time (optional; omitted keeps
 *  the existing value). Everything here is integer paise. */
export const markCommissionReceivedSchema = z
  .object({
    paidToPgPaise: z.number().int().nonnegative().optional(),
    note: z.string().min(1).max(500).optional(),
  })
  .strict();
export type MarkCommissionReceivedInput = z.infer<typeof markCommissionReceivedSchema>;

/** Body for bulk mark-received — an explicit, bounded list of booking ids. */
export const bulkMarkCommissionReceivedSchema = z
  .object({ bookingIds: z.array(z.string().uuid()).min(1).max(200) })
  .strict();
export type BulkMarkCommissionReceivedInput = z.infer<typeof bulkMarkCommissionReceivedSchema>;

// ---------------------------------------------------------------------------
// ERP-2 — bookings ledger, approvals, and booking/KYC detail (§15.3).
// ---------------------------------------------------------------------------

/** Sortable columns for the bookings ledger (allowlist — nothing else is sortable). */
export const bookingLedgerSortSchema = z.enum(["createdAt", "moveInDate", "confirmedAt", "monthlyRent"]);
export type BookingLedgerSort = z.infer<typeof bookingLedgerSortSchema>;
export const sortOrderSchema = z.enum(["asc", "desc"]);

/**
 * GET /v1/erp/bookings — the searchable/sortable bookings ledger (§15.3). Every
 * filter is optional: `approval` (the derived decision state), `listingId` /
 * `agentId` / `tenantId`, and `q` (a free-text match on the tenant name or the
 * listing alias). `sort`/`order` pick the column + direction (default: newest
 * first). Cursor-paginated with an enforced max page size.
 */
export const bookingsLedgerQuerySchema = z
  .object({
    approval: bookingApprovalStatusSchema.optional(),
    listingId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(120).optional(),
    sort: bookingLedgerSortSchema.default("createdAt"),
    order: sortOrderSchema.default("desc"),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type BookingsLedgerQuery = z.infer<typeof bookingsLedgerQuerySchema>;

/** GET /v1/erp/bookings/export — the same filters, no pagination, plus a format. */
export const bookingsLedgerExportQuerySchema = z
  .object({
    format: z.enum(["csv", "xlsx"]),
    approval: bookingApprovalStatusSchema.optional(),
    listingId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(120).optional(),
    sort: bookingLedgerSortSchema.default("createdAt"),
    order: sortOrderSchema.default("desc"),
  })
  .strict();
export type BookingsLedgerExportQuery = z.infer<typeof bookingsLedgerExportQuerySchema>;

/** GET /v1/erp/approvals — the pending-decision queue (cursor-paginated). */
export const bookingApprovalsQuerySchema = z
  .object({ cursor: cursorParam, limit: limitSchema })
  .strict();
export type BookingApprovalsQuery = z.infer<typeof bookingApprovalsQuerySchema>;

/** Body for rejecting a pending booking in review — a mandatory reason (audited). */
export const rejectBookingSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type RejectBookingInput = z.infer<typeof rejectBookingSchema>;

/** Body for bulk-approving several clearly-fine pending bookings. */
export const bulkApproveBookingsSchema = z
  .object({ bookingIds: z.array(z.string().uuid()).min(1).max(200) })
  .strict();
export type BulkApproveBookingsInput = z.infer<typeof bulkApproveBookingsSchema>;

/**
 * Body for adding a HISTORICAL booking (§15.3) — a back-dated, already-confirmed
 * booking assigned to an agent that flows into the dashboard / commission ledger /
 * agent performance exactly like a live one. `moveInDate` must be in the past
 * (validated server-side against `now`); the booking is created CONFIRMED with
 * `confirmedAt = moveInDate`. `bedId` is row-locked so the one-live-booking
 * invariant still holds. Money is integer paise.
 */
export const createHistoricalBookingSchema = z
  .object({
    bedId: z.string().uuid(),
    tenantName: z.string().trim().min(1).max(120),
    tenantPhone: e164Schema,
    agentId: z.string().uuid(),
    agentChannel: agentBookingChannelSchema.default("WALK_IN"),
    moveInDate: z.string().datetime(),
    monthlyRentPaise: z.number().int().nonnegative(),
    tokenAmountPaise: z.number().int().nonnegative(),
    depositPaise: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CreateHistoricalBookingInput = z.infer<typeof createHistoricalBookingSchema>;

/**
 * Body for editing a booking (§15.3, audited). Only the safe correction fields
 * are editable — never the token (payment truth) or attribution. At least one
 * field must be present.
 */
export const updateBookingSchema = z
  .object({
    moveInDate: z.string().datetime().nullable().optional(),
    monthlyRentPaise: z.number().int().nonnegative().optional(),
    depositPaise: z.number().int().nonnegative().optional(),
    mealPlan: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update" });
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

// ---------------------------------------------------------------------------
// ERP-3 — Invoice Center (§15.6/§15.7).
// ---------------------------------------------------------------------------

/** Which invoice a Review / PDF / send request targets. Query param; defaults to
 *  the CUSTOMER invoice (the Invoice Center's primary surface). */
export const invoiceTypeQuerySchema = z
  .object({ type: invoiceTypeSchema.default("CUSTOMER") })
  .strict();
export type InvoiceTypeQuery = z.infer<typeof invoiceTypeQuerySchema>;

/**
 * GET /v1/erp/invoices — the Invoice Center list (§15.7). `type` picks which
 * invoice (customer/commission); `status` optionally filters DRAFT vs SENT; `q`
 * matches the recipient name or listing alias. Cursor-paginated, capped page.
 */
export const invoiceListQuerySchema = z
  .object({
    type: invoiceTypeSchema.default("CUSTOMER"),
    status: invoiceStatusSchema.optional(),
    q: z.string().trim().min(1).max(120).optional(),
    cursor: cursorParam,
    limit: limitSchema,
  })
  .strict();
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/**
 * PATCH /v1/erp/invoices/:bookingId — edit a CUSTOMER invoice's NON-DERIVABLE
 * figures: the maintenance / electricity line items and/or the amount-paid
 * override. The engine-owned deposit / pro-rata rent are NOT editable here — they
 * always come from ERP-1 — so an edit can never corrupt an engine figure. At
 * least one field is required. All money is integer paise.
 */
export const updateInvoiceSchema = z
  .object({
    maintenancePaise: z.number().int().nonnegative().optional(),
    electricityPaise: z.number().int().nonnegative().optional(),
    paidPaise: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update" });
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/** POST /v1/erp/invoices/send — bulk-send invoices of one type to their
 *  recipients (an explicit, bounded list of bookings). */
export const bulkSendInvoicesSchema = z
  .object({
    type: invoiceTypeSchema,
    bookingIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();
export type BulkSendInvoicesInput = z.infer<typeof bulkSendInvoicesSchema>;

// ---------------------------------------------------------------------------
// ERP-4 — Dashboard, Money Manager, and Agents (§15.3). All three obey the ONE
// §15.3 global finance filter (FY / quarter / month / property / agent), so a
// single filter scopes every screen identically. The filter mirrors the
// commission-ledger query (same FY/quarter/month semantics, same property/agent
// scoping) minus pagination — these are roll-up surfaces, not paged lists. Every
// money figure they return is engine-sourced (priced through erp.pricing); the
// schema only carries the filter, never a figure.
// ---------------------------------------------------------------------------

/** The §15.3 global finance filter shared by dashboard / money-manager / agents.
 *  `financialYear` is the Indian FY start year; `quarter` (1–4) and `month`
 *  (calendar 1–12) are mutually exclusive and resolved WITHIN the FY. `listingId`
 *  scopes to one property, `agentId` to one agent. All optional; when no period is
 *  given the server defaults to the current FY (always period-bounded). */
export const erpFinanceFilterSchema = z
  .object({
    financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
    quarter: z.coerce.number().int().min(1).max(4).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    listingId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  })
  .strict()
  .refine((q) => !(q.quarter !== undefined && q.month !== undefined), {
    message: "provide quarter or month, not both",
    path: ["month"],
  });
export type ErpFinanceFilter = z.infer<typeof erpFinanceFilterSchema>;

/**
 * POST /v1/erp/agents/bookings/:bookingId/reassign — ADMIN back-office correction
 * that moves a booking's agent attribution to a different AGENT (§15.3). Because
 * commission is DERIVED on read by the money engine from the booking's rent + its
 * agent link (never stored per-agent), moving the link automatically moves the
 * commission, the agent's performance, and the leaderboard — there is no separate
 * commission path to update. ADMIN-only and audited (records the before/after agent).
 */
export const reassignBookingSchema = z.object({ agentId: z.string().uuid() }).strict();
export type ReassignBookingInput = z.infer<typeof reassignBookingSchema>;

// ---------------------------------------------------------------------------
// ERP-5 — CA & Compliance and Settings / Users (§15.3 / §15.7).
// ---------------------------------------------------------------------------

/** The six standard report exports (also the CA pack's six sheets). */
export const erpReportKindSchema = z.enum([
  "bookings-ledger",
  "commission-ledger",
  "customer-invoices",
  "commission-invoices",
  "collections-settlements",
  "summary",
]);
export type ErpReportKind = z.infer<typeof erpReportKindSchema>;

/** GET /v1/erp/ca-pack — the one-click multi-sheet compliance workbook, scoped to
 *  a financial year. When `financialYear` is omitted the server uses the active FY
 *  from settings (else the FY of now). */
export const caPackQuerySchema = z
  .object({ financialYear: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();
export type CaPackQuery = z.infer<typeof caPackQuerySchema>;

/** Path param for GET /v1/erp/reports/:report. */
export const erpReportParamSchema = z.object({ report: erpReportKindSchema }).strict();

/** GET /v1/erp/reports/:report — one report, as xlsx (default) or csv, FY-scoped. */
export const erpReportQuerySchema = z
  .object({
    financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
    format: z.enum(["xlsx", "csv"]).default("xlsx"),
  })
  .strict();
export type ErpReportQuery = z.infer<typeof erpReportQuerySchema>;

/** The only role a §15.7 team login may hold: back-office access is ADMIN. Kept as
 *  an enum so the assignable set can grow without changing the route contract. */
export const erpTeamRoleSchema = z.enum(["ADMIN"]);
export type ErpTeamRole = z.infer<typeof erpTeamRoleSchema>;

/**
 * POST /v1/erp/team — add a back-office team login (§15.7/§15.8, server-side).
 * The admin supplies a temp password; the account is created with a forced
 * first-login password change. Email is the login identity (lower-cased, unique).
 */
export const addTeamMemberSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    email: z.string().email().toLowerCase(),
    tempPassword: z.string().min(8, "Temp password must be at least 8 characters").max(200),
    role: erpTeamRoleSchema.default("ADMIN"),
  })
  .strict();
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;

/**
 * PUT /v1/erp/settings — update the singleton org settings (§15.7): company
 * details, the active financial year, and the operating-mode flags. Every field
 * is optional; at least one must be present. Strings can be cleared with null.
 */
// ---------------------------------------------------------------------------
export const updateOrgSettingsSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    gstin: z.string().trim().max(30).nullable().optional(),
    pan: z.string().trim().max(20).nullable().optional(),
    addressLine: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    state: z.string().trim().max(120).nullable().optional(),
    pincode: z.string().trim().max(12).nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().trim().max(20).nullable().optional(),
    financialYear: z.number().int().min(2000).max(2100).nullable().optional(),
    onlineBookingsEnabled: z.boolean().optional(),
    walkInBookingsEnabled: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update" });
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsSchema>;
