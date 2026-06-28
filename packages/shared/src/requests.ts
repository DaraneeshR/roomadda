import { z } from "zod";
import {
  adSlotTypeSchema,
  bookingStatusSchema,
  e164Schema,
  genderPolicySchema,
  kycStatusSchema,
  listingStatusSchema,
  occupationTypeSchema,
  paymentStatusSchema,
  userGenderSchema,
  userRoleSchema,
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

export const roomParamSchema = z.object({ id: z.string().uuid(), roomId: z.string().uuid() }).strict();

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
