import { z } from "zod";
import { limitSchema } from "../../lib/pagination.js";

/** GET /v1/bookings query: cursor (a booking id) + capped page size. */
export const listBookingsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: limitSchema,
  })
  .strict();

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

export const createBookingSchema = z
  .object({
    bedId: z.string().uuid(),
    moveInDate: z.coerce.date().optional(),
  })
  .strict();

export const bookingIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const cashCollectionParamSchema = z.object({ id: z.string().uuid() }).strict();

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

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;
