import { randomUUID } from "node:crypto";
import { Prisma, UserRole, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { smsSender } from "../../lib/sms.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  hashOtpCode,
  signAccessToken,
} from "../../lib/tokens.js";
import { acquireCooldown, hitFixedWindow } from "../../lib/rate-limit.js";
import type { AppAudience } from "@roomadda/shared";
import {
  audienceAllowsRole,
  evaluateRefresh,
  generateOtpCode,
  verifyOtpAttempt,
} from "./auth.logic.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ONE_HOUR_SECONDS = 60 * 60;

/** Last 4 digits only — avoid full phone PII in audit metadata. */
const suffix = (phone: string): string => phone.slice(-4);

const otpInvalid = (): AppError =>
  new AppError({ statusCode: 401, code: "OTP_INVALID", message: "Invalid or expired code" });
const otpLocked = (): AppError =>
  new AppError({
    statusCode: 401,
    code: "OTP_LOCKED",
    message: "Too many attempts. Request a new code.",
  });
const refreshInvalid = (): AppError =>
  new AppError({ statusCode: 401, code: "REFRESH_INVALID", message: "Invalid refresh token" });

export interface IssuedSession {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/** Create a refresh token row (in `familyId`) and a matching access token. */
async function issueSession(
  tx: Prisma.TransactionClient,
  userId: string,
  role: UserRole,
  familyId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = generateRefreshToken();
  await tx.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  const accessToken = await signAccessToken({ sub: userId, role });
  return { accessToken, refreshToken };
}

export const authService = {
  /** Generate, store (hashed) and send an OTP, enforcing the rate limits. */
  async requestOtp({ phone, ip }: { phone: string; ip?: string }): Promise<{ expiresInSeconds: number }> {
    // 30s resend cooldown (acquire-first; a blocked resend never increments counters).
    const fresh = await acquireCooldown(redis, `otp:cd:${phone}`, env.OTP_RESEND_COOLDOWN_SECONDS);
    if (!fresh) {
      throw new AppError({
        statusCode: 429,
        code: "OTP_COOLDOWN",
        message: "Please wait before requesting another code",
      });
    }

    const perPhone = await hitFixedWindow(
      redis,
      `otp:rl:phone:${phone}`,
      env.OTP_MAX_PER_PHONE_PER_HOUR,
      ONE_HOUR_SECONDS,
    );
    if (!perPhone.allowed) {
      throw new AppError({
        statusCode: 429,
        code: "OTP_RATE_LIMITED",
        message: "Too many OTP requests for this number. Try again later.",
      });
    }

    if (ip) {
      const perIp = await hitFixedWindow(
        redis,
        `otp:rl:ip:${ip}`,
        env.OTP_MAX_PER_IP_PER_HOUR,
        ONE_HOUR_SECONDS,
      );
      if (!perIp.allowed) {
        throw new AppError({
          statusCode: 429,
          code: "OTP_RATE_LIMITED",
          message: "Too many OTP requests from this network. Try again later.",
        });
      }
    }

    const now = new Date();
    const code = generateOtpCode();
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

    // Invalidate any still-active code for this phone, then store the new hash.
    await prisma.$transaction([
      prisma.otpRequest.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: now },
      }),
      prisma.otpRequest.create({
        data: { phone, codeHash: hashOtpCode(code), expiresAt, ip: ip ?? null },
      }),
    ]);

    await smsSender.sendOtp(phone, code);
    await writeAudit({ action: "auth.otp.requested", ip, metadata: { phoneSuffix: suffix(phone) } });

    return { expiresInSeconds: env.OTP_TTL_SECONDS };
  },

  /** Verify an OTP; on success upsert the user and issue a session. */
  async verifyOtp({
    phone,
    code,
    ip,
    appAudience,
  }: {
    phone: string;
    code: string;
    ip?: string;
    appAudience?: AppAudience;
  }): Promise<IssuedSession> {
    const now = new Date();
    const record = await prisma.otpRequest.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      await writeAudit({
        action: "auth.otp.verify_failed",
        ip,
        metadata: { phoneSuffix: suffix(phone), reason: "no_active_request" },
      });
      throw otpInvalid();
    }

    const decision = verifyOtpAttempt(record, code, { now, maxAttempts: env.OTP_MAX_ATTEMPTS });

    if (decision.status === "invalid") {
      // Count the attempt; lock (consume) the record once attempts are exhausted.
      await prisma.otpRequest.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 }, ...(decision.lockNow ? { consumedAt: now } : {}) },
      });
      await writeAudit({
        action: "auth.otp.verify_failed",
        ip,
        metadata: { phoneSuffix: suffix(phone), reason: decision.lockNow ? "locked_out" : "wrong_code" },
      });
      throw decision.lockNow ? otpLocked() : otpInvalid();
    }

    if (decision.status !== "ok") {
      await writeAudit({
        action: "auth.otp.verify_failed",
        ip,
        metadata: { phoneSuffix: suffix(phone), reason: decision.status },
      });
      throw decision.status === "locked" ? otpLocked() : otpInvalid();
    }

    // App gate: a number whose role this app doesn't serve is turned away BEFORE
    // the code is consumed or a session issued — no tokens ever reach the wrong
    // app, and the user can retry in the correct app with the same code. New
    // numbers resolve to TENANT (the upsert default below). Server-side mirror of
    // the client gate (see /CLAUDE.md: default-deny authorization).
    if (appAudience) {
      const existing = await prisma.user.findUnique({
        where: { phone },
        select: { role: true },
      });
      const resolvedRole = existing?.role ?? UserRole.TENANT;
      if (!audienceAllowsRole(appAudience, resolvedRole)) {
        await writeAudit({
          action: "auth.otp.wrong_app",
          ip,
          metadata: { phoneSuffix: suffix(phone), audience: appAudience, role: resolvedRole },
        });
        throw new AppError({
          statusCode: 403,
          code: "WRONG_APP",
          message: "This number is registered for a different RoomAdda app.",
          details: { role: resolvedRole },
        });
      }
    }

    // Success: consume the code, upsert the user, issue a fresh session — atomically.
    const result = await prisma.$transaction(async (tx) => {
      await tx.otpRequest.update({ where: { id: record.id }, data: { consumedAt: now } });
      const user = await tx.user.upsert({
        where: { phone },
        create: { phone, role: UserRole.TENANT, fullName: "", isPhoneVerified: true },
        update: { isPhoneVerified: true },
      });
      const session = await issueSession(tx, user.id, user.role, randomUUID());
      return { user, ...session };
    });

    await writeAudit({
      actorId: result.user.id,
      action: "auth.login",
      targetId: result.user.id,
      ip,
      metadata: { method: "otp" },
    });
    return result;
  },

  /** Rotate a refresh token. Detects reuse and revokes the whole family. */
  async rotateRefresh({
    presentedToken,
    ip,
  }: {
    presentedToken: string;
    ip?: string;
  }): Promise<IssuedSession> {
    const now = new Date();
    const tokenHash = hashRefreshToken(presentedToken);
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    const decision = evaluateRefresh(record, now);

    if (!record || decision === "invalid") throw refreshInvalid();

    if (decision === "reuse_detected") {
      // A revoked token was replayed: revoke every live token in the family.
      await prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAudit({
        actorId: record.userId,
        action: "auth.refresh.reuse_detected",
        targetId: record.userId,
        ip,
        metadata: { familyId: record.familyId },
      });
      throw new AppError({
        statusCode: 401,
        code: "REFRESH_REUSE_DETECTED",
        message: "Session revoked for your security. Please sign in again.",
      });
    }

    if (decision === "expired") {
      throw new AppError({ statusCode: 401, code: "REFRESH_EXPIRED", message: "Session expired" });
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) throw refreshInvalid();

    // Rotate: revoke the presented token and mint a successor in the same family.
    const result = await prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: now } });
      const session = await issueSession(tx, user.id, user.role, record.familyId);
      return { user, ...session };
    });

    await writeAudit({
      actorId: user.id,
      action: "auth.refresh.rotated",
      targetId: user.id,
      ip,
      metadata: { familyId: record.familyId },
    });
    return result;
  },

  /** Revoke the session (whole family) for a presented token. Idempotent. */
  async logout({ presentedToken, ip }: { presentedToken?: string; ip?: string }): Promise<void> {
    if (!presentedToken) return;
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presentedToken) },
    });
    if (!record) return;
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      actorId: record.userId,
      action: "auth.logout",
      targetId: record.userId,
      ip,
      metadata: { familyId: record.familyId },
    });
  },

  /** Admin role change. Revokes the target's sessions so the new role takes hold. */
  async changeRole({
    actorId,
    targetUserId,
    newRole,
    ip,
  }: {
    actorId: string;
    targetUserId: string;
    newRole: UserRole;
    ip?: string;
  }): Promise<User> {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      throw new AppError({ statusCode: 404, code: "USER_NOT_FOUND", message: "User not found" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: targetUserId }, data: { role: newRole } });
      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return user;
    });

    await writeAudit({
      actorId,
      action: "auth.role.changed",
      targetId: targetUserId,
      ip,
      metadata: { from: target.role, to: newRole },
    });
    return updated;
  },
};
