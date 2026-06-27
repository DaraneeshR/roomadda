import { logger } from "./logger.js";

export interface KycDecisionNotice {
  userId: string;
  status: "VERIFIED" | "REJECTED";
  reason?: string;
}

/**
 * Best-effort notification of an admin's KYC decision.
 *
 * The tenant app's primary surface is GET /v1/kyc/me (it reads status + reason
 * to drive the booking gate); this is the seam where an out-of-band push /
 * WhatsApp delivery plugs in once a notification channel exists. Best-effort:
 * a failure here NEVER breaks the admin action that triggered it. Only the user
 * id and status are logged — no PII (see /CLAUDE.md).
 */
export async function notifyKycDecision(notice: KycDecisionNotice): Promise<void> {
  try {
    logger.info({ userId: notice.userId, status: notice.status }, "kyc decision notification");
    // TODO: deliver via push/WhatsApp once a notification channel is wired up.
  } catch (err) {
    logger.error({ err }, "failed to send KYC decision notification");
  }
}
