import { randomInt } from "node:crypto";
import type { AppAudience } from "@roomadda/shared";
import { hashOtpCode, safeHashEqual } from "../../lib/tokens.js";

/** Role names as the app gate cares about them (matches Prisma's UserRole). */
type GateRole = "TENANT" | "HOST" | "AGENT" | "ADMIN";

/**
 * Whether an app audience may serve a given role. The tenant app serves only
 * TENANT; the host_agent app serves HOST and AGENT. ADMIN belongs to neither
 * (admins use the web console). Pure so the per-app gate is unit-tested without
 * a database — the service resolves the role, this decides allow/deny.
 */
export function audienceAllowsRole(audience: AppAudience, role: GateRole): boolean {
  if (audience === "tenant") return role === "TENANT";
  return role === "HOST" || role === "AGENT";
}

/**
 * Pure auth decisions — no I/O — so the security-critical rules are unit-tested
 * without a database or Redis. The service applies the returned decisions.
 */

export interface OtpRecordView {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type OtpDecision =
  | { status: "ok" }
  | { status: "expired" }
  | { status: "already_used" }
  | { status: "locked" }
  | { status: "invalid"; lockNow: boolean; attemptsRemaining: number };

export interface VerifyOtpOptions {
  now: Date;
  maxAttempts: number;
  /** Injectable for tests; defaults to the real HMAC hash. */
  hashCode?: (code: string) => string;
}

export function verifyOtpAttempt(
  record: OtpRecordView,
  code: string,
  opts: VerifyOtpOptions,
): OtpDecision {
  const hashCode = opts.hashCode ?? hashOtpCode;
  if (record.consumedAt !== null) return { status: "already_used" };
  if (opts.now.getTime() > record.expiresAt.getTime()) return { status: "expired" };
  if (record.attempts >= opts.maxAttempts) return { status: "locked" };

  if (safeHashEqual(hashCode(code), record.codeHash)) {
    return { status: "ok" };
  }

  const nextAttempts = record.attempts + 1;
  return {
    status: "invalid",
    lockNow: nextAttempts >= opts.maxAttempts,
    attemptsRemaining: Math.max(0, opts.maxAttempts - nextAttempts),
  };
}

export interface RefreshRecordView {
  revokedAt: Date | null;
  expiresAt: Date;
}

export type RefreshDecision = "rotate" | "reuse_detected" | "expired" | "invalid";

/**
 * Decide what to do with a presented refresh token. A *revoked* token being
 * presented means a leaked/stolen token is being replayed → reuse_detected,
 * which the service turns into a full-family revocation.
 */
export function evaluateRefresh(record: RefreshRecordView | null, now: Date): RefreshDecision {
  if (!record) return "invalid";
  if (record.revokedAt !== null) return "reuse_detected";
  if (now.getTime() > record.expiresAt.getTime()) return "expired";
  return "rotate";
}

/** Cryptographically-random 6-digit OTP, zero-padded. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
