import { z } from "zod";
import { BookingStatus, KycStatus, ListingStatus, PaymentStatus } from "@prisma/client";
import { limitSchema } from "../../lib/pagination.js";

export const idParamSchema = z.object({ id: z.string().uuid() }).strict();
export const rejectSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

const cursor = z.string().uuid().optional();

export const kycQuerySchema = z
  .object({ status: z.nativeEnum(KycStatus).default("PENDING"), cursor, limit: limitSchema })
  .strict();

export const listingReviewQuerySchema = z
  .object({ status: z.nativeEnum(ListingStatus).default("PENDING_REVIEW"), cursor, limit: limitSchema })
  .strict();

export const cashQuerySchema = z.object({ cursor, limit: limitSchema }).strict();

export const bookingSearchSchema = z
  .object({
    status: z.nativeEnum(BookingStatus).optional(),
    tenantId: z.string().uuid().optional(),
    listingId: z.string().uuid().optional(),
    cursor,
    limit: limitSchema,
  })
  .strict();

export const paymentSearchSchema = z
  .object({
    status: z.nativeEnum(PaymentStatus).optional(),
    bookingId: z.string().uuid().optional(),
    cursor,
    limit: limitSchema,
  })
  .strict();
