import { z } from "zod";
import { UserRole } from "@prisma/client";

/**
 * Boundary schemas. Every external input is parsed with `.strict()` so unknown
 * keys are rejected (see /CLAUDE.md security rules).
 */
const phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164, e.g. +919876543210");

const clientType = z.enum(["web", "mobile"]);

export const otpRequestSchema = z.object({ phone }).strict();

export const otpVerifySchema = z
  .object({
    phone,
    code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
    client: clientType,
  })
  .strict();

export const refreshSchema = z
  .object({
    client: clientType,
    // Required for mobile clients; web clients send it via httpOnly cookie.
    refreshToken: z.string().min(1).optional(),
  })
  .strict();

export const logoutSchema = z
  .object({ refreshToken: z.string().min(1).optional() })
  .strict();

export const roleChangeBodySchema = z.object({ role: z.nativeEnum(UserRole) }).strict();
export const userIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type ClientType = z.infer<typeof clientType>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
