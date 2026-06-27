import { describe, it, expect } from "vitest";
import {
  audienceAllowsRole,
  evaluateRefresh,
  verifyOtpAttempt,
  type OtpRecordView,
} from "./auth.logic.js";

// Identity hash so we can assert decisions without the real HMAC.
const identity = (code: string) => code;
const now = new Date();

const baseOtp: OtpRecordView = {
  codeHash: "123456",
  expiresAt: new Date(now.getTime() + 60_000),
  attempts: 0,
  consumedAt: null,
};

describe("verifyOtpAttempt (attempt lockout)", () => {
  const opts = { now, maxAttempts: 5, hashCode: identity };

  it("accepts a correct code", () => {
    expect(verifyOtpAttempt(baseOtp, "123456", opts).status).toBe("ok");
  });

  it("rejects an expired code", () => {
    const expired = { ...baseOtp, expiresAt: new Date(now.getTime() - 1) };
    expect(verifyOtpAttempt(expired, "123456", opts).status).toBe("expired");
  });

  it("rejects an already-used code", () => {
    const used = { ...baseOtp, consumedAt: new Date() };
    expect(verifyOtpAttempt(used, "123456", opts).status).toBe("already_used");
  });

  it("reports locked once attempts are exhausted", () => {
    expect(verifyOtpAttempt({ ...baseOtp, attempts: 5 }, "123456", opts).status).toBe("locked");
  });

  it("counts wrong codes and flags lockNow on the final attempt", () => {
    expect(verifyOtpAttempt({ ...baseOtp, attempts: 0 }, "000000", opts)).toMatchObject({
      status: "invalid",
      lockNow: false,
      attemptsRemaining: 4,
    });
    expect(verifyOtpAttempt({ ...baseOtp, attempts: 4 }, "000000", opts)).toMatchObject({
      status: "invalid",
      lockNow: true,
      attemptsRemaining: 0,
    });
  });
});

describe("audienceAllowsRole (per-app role gate)", () => {
  it("tenant app serves only TENANT", () => {
    expect(audienceAllowsRole("tenant", "TENANT")).toBe(true);
    // Mismatch direction 1: a host/agent signing into the tenant app is rejected.
    expect(audienceAllowsRole("tenant", "HOST")).toBe(false);
    expect(audienceAllowsRole("tenant", "AGENT")).toBe(false);
    expect(audienceAllowsRole("tenant", "ADMIN")).toBe(false);
  });

  it("host_agent app serves HOST and AGENT, not TENANT/ADMIN", () => {
    expect(audienceAllowsRole("host_agent", "HOST")).toBe(true);
    expect(audienceAllowsRole("host_agent", "AGENT")).toBe(true);
    // Mismatch direction 2: a tenant signing into the host_agent app is rejected.
    expect(audienceAllowsRole("host_agent", "TENANT")).toBe(false);
    expect(audienceAllowsRole("host_agent", "ADMIN")).toBe(false);
  });
});

describe("evaluateRefresh (rotation + reuse detection)", () => {
  it("invalid for an unknown token", () => {
    expect(evaluateRefresh(null, now)).toBe("invalid");
  });

  it("reuse_detected for a revoked token (replay)", () => {
    expect(
      evaluateRefresh({ revokedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 1000) }, now),
    ).toBe("reuse_detected");
  });

  it("expired for a past expiry", () => {
    expect(evaluateRefresh({ revokedAt: null, expiresAt: new Date(now.getTime() - 1) }, now)).toBe("expired");
  });

  it("rotate for an active token", () => {
    expect(evaluateRefresh({ revokedAt: null, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe("rotate");
  });
});
