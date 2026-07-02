import { z } from "zod";
import {
  adSlotTypeSchema,
  agentVisitStatusSchema,
  amenityCheckSchema,
  bookingStatusSchema,
  e164Schema,
  genderPolicySchema,
  inspectionRecommendationSchema,
  inspectionStatusSchema,
  kycStatusSchema,
  listingStatusSchema,
  chatMessageKindSchema,
  occupationTypeSchema,
  paymentStatusSchema,
  serviceRequestCategorySchema,
  serviceRequestPrioritySchema,
  serviceRequestStatusSchema,
  userGenderSchema,
  userRoleSchema,
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
