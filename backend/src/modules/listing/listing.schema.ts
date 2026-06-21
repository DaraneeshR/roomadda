import { z } from "zod";
import { GenderPolicy, ListingStatus } from "@prisma/client";
import { limitSchema } from "../../lib/pagination.js";

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
    gender: z.nativeEnum(GenderPolicy).default(GenderPolicy.COED),
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
    gender: z.nativeEnum(GenderPolicy),
    amenities,
    status: z.nativeEnum(ListingStatus),
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

export const listingIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const roomParamSchema = z
  .object({ id: z.string().uuid(), roomId: z.string().uuid() })
  .strict();

export const listFiltersSchema = z
  .object({
    city: z.string().min(1).max(120).optional(),
    area: z.string().min(1).max(120).optional(),
    gender: z.nativeEnum(GenderPolicy).optional(),
    sharingType: z.coerce.number().int().min(1).max(20).optional(),
    minRentPaise: z.coerce.number().int().nonnegative().optional(),
    maxRentPaise: z.coerce.number().int().nonnegative().optional(),
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
    cursor: z.string().uuid().optional(),
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
