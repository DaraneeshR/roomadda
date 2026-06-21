import { z } from "zod";
import { AdSlotType } from "@prisma/client";
import { limitSchema } from "../../lib/pagination.js";

export const slotTypeParamSchema = z.object({ slotType: z.nativeEnum(AdSlotType) }).strict();

export const putPricingSchema = z
  .object({ pricePaise: z.number().int().positive(), isActive: z.boolean().default(true) })
  .strict();

export const createAdSchema = z
  .object({
    listingId: z.string().uuid(),
    slotType: z.nativeEnum(AdSlotType),
    startDate: z.coerce
      .date()
      .refine((d) => d.getTime() >= Date.now() - 24 * 60 * 60 * 1000, "startDate cannot be in the past"),
  })
  .strict();

export const adIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const rejectAdSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export const featuredQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }).strict();
export const pendingAdsQuerySchema = z.object({ cursor: z.string().uuid().optional(), limit: limitSchema }).strict();

export type PutPricingInput = z.infer<typeof putPricingSchema>;
export type CreateAdInput = z.infer<typeof createAdSchema>;
