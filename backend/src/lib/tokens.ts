import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";

/**
 * Token primitives.
 *  - Access token: short-lived (15m) HS256 JWT, payload { sub, role }.
 *  - Refresh token: opaque 256-bit random string; only its SHA-256 hash is
 *    ever persisted. The raw value is returned to the client exactly once.
 */

const ACCESS_TTL = "15m";
const ISSUER = "roomadda";
const AUDIENCE = "roomadda-api";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(ACCESS_TTL)
    .sign(accessSecret);
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.nativeEnum(UserRole),
});

/** Verify an access token. Throws on any invalid/expired/tampered token. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, accessSecret, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return claimsSchema.parse({ sub: payload.sub, role: payload.role });
}

/** A new opaque refresh token (256 bits of entropy, URL-safe). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash (hex) of a refresh token — what we persist and look up by. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * HMAC-SHA256 of an OTP code, domain-separated and keyed by the access secret.
 * Combined with the 5-attempt lockout + 5-minute expiry this is sufficient for
 * a 6-digit code; it never needs to be reversible.
 */
export function hashOtpCode(code: string): string {
  return createHash("sha256")
    .update(`otp:${env.JWT_ACCESS_SECRET}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeHashEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
