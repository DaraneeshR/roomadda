import { env, isProduction } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import { smsSender } from "./sms.js";

/**
 * Safety + leave-notice notifications, behind one env-gated interface (the same
 * Live/Stub pattern as sms.ts / chat-transport.ts). SOS is safety-critical, so
 * the LIVE notifier MUST actually reach a human: it fans the alert out to an ops
 * SMS distribution list (via the env-gated SMS sender) and/or an ops webhook
 * (Slack/Teams/PagerDuty). The STUB only logs intent (ids, never PII) for
 * dev/test. Best-effort by contract: a failure here never breaks the action that
 * triggered it, and the prod boot guard (config/env.ts) refuses to start with no
 * ops channel configured.
 */

export interface SosAdminAlert {
  userId: string;
  userName: string;
  userPhone: string;
  /** Maps link, or a "location unavailable" note when GPS was missing. */
  locationText: string;
  hasLocation: boolean;
  contactsNotified: number;
}

export interface LeaveNoticeAlert {
  noticeId: string;
  tenantName: string;
  listingAlias: string;
  /** The owning host to notify (alongside admin/ops). */
  hostId: string;
  hostName: string;
  moveOutDate: Date;
}

export interface SafetyNotifier {
  /** Alert the admin/ops channel that a user triggered SOS. */
  sosToAdmin(alert: SosAdminAlert): Promise<void>;
  /** Notify the host + admin that a tenant served notice to vacate. */
  leaveNoticeSubmitted(alert: LeaveNoticeAlert): Promise<void>;
}

/** Dev/test default: logs intent only (no PII, no gateway). */
class StubSafetyNotifier implements SafetyNotifier {
  sosToAdmin(alert: SosAdminAlert): Promise<void> {
    logger.warn(
      { userId: alert.userId, contactsNotified: alert.contactsNotified, hasLocation: alert.hasLocation },
      "SOS admin alert (stub — dev no-op, ops channel only sends in prod)",
    );
    return Promise.resolve();
  }

  leaveNoticeSubmitted(alert: LeaveNoticeAlert): Promise<void> {
    logger.info(
      { noticeId: alert.noticeId, hostId: alert.hostId },
      "leave notice submitted notification (stub — host + admin)",
    );
    return Promise.resolve();
  }
}

export interface SafetyOpsChannels {
  /** E.164 on-call numbers; each gets an SOS SMS via the env-gated sender. */
  opsSmsNumbers: string[];
  /** Optional ops webhook (Slack/Teams/PagerDuty) for a structured alert. */
  opsWebhookUrl?: string;
}

/**
 * Live notifier: delivers SOS to the real ops channel(s). Each leg is
 * independent and best-effort (one failing leg never blocks the others, and
 * nothing throws to the caller). Constructed with its destinations so it is
 * unit-testable without touching env.
 */
export class LiveSafetyNotifier implements SafetyNotifier {
  constructor(private readonly channels: SafetyOpsChannels) {}

  async sosToAdmin(alert: SosAdminAlert): Promise<void> {
    const legs: Promise<void>[] = [];

    // Ops SMS distribution list — the reliable channel (poor connectivity), one
    // SMS per on-call number through the SAME env-gated SMS interface.
    for (const toPhone of this.channels.opsSmsNumbers) {
      legs.push(
        smsSender
          .sendOpsSos({ toPhone, userName: alert.userName, userPhone: alert.userPhone, locationText: alert.locationText })
          // Log the id only — never the recipient/PII (see /CLAUDE.md).
          .catch((err) => logger.error({ err, userId: alert.userId }, "SOS ops SMS failed")),
      );
    }

    // Ops webhook — structured context to a monitored channel.
    if (this.channels.opsWebhookUrl) {
      legs.push(
        this.postWebhook(this.channels.opsWebhookUrl, alert).catch((err) =>
          logger.error({ err, userId: alert.userId }, "SOS ops webhook failed"),
        ),
      );
    }

    if (legs.length === 0) {
      // Should be unreachable in prod (boot guard), but if it ever is, this is a
      // safety-defeating misconfiguration — surface it loudly.
      logger.error({ userId: alert.userId }, "SOS ops alert had NO configured channel — emergency NOT delivered to ops");
      return;
    }

    await Promise.allSettled(legs);
  }

  leaveNoticeSubmitted(alert: LeaveNoticeAlert): Promise<void> {
    // Leave-notice delivery is out of SOS scope; keep the audit log for now.
    logger.info(
      { noticeId: alert.noticeId, hostId: alert.hostId },
      "leave notice submitted notification (host + admin)",
    );
    return Promise.resolve();
  }

  /**
   * POST a structured SOS alert to the ops webhook. The body carries the user's
   * name, callback number and location — PII that is NECESSARY for ops to act on
   * the emergency (and authorized: this is the user's own safety alert to the
   * trusted ops team, not a public listing response). The URL may embed a secret
   * token, so it is NEVER logged.
   */
  private async postWebhook(url: string, alert: SosAdminAlert): Promise<void> {
    const where = alert.hasLocation ? `Location: ${alert.locationText}` : "No GPS fix";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // `text` renders directly in Slack/Teams incoming webhooks.
        text: `🚨 SOS from ${alert.userName} (${alert.userPhone}). ${where}. Trusted contacts notified: ${alert.contactsNotified}.`,
        event: "sos.triggered",
        userId: alert.userId,
        userName: alert.userName,
        userPhone: alert.userPhone,
        location: alert.locationText,
        hasLocation: alert.hasLocation,
        contactsNotified: alert.contactsNotified,
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "SOS ops webhook non-2xx");
      throw new AppError({ statusCode: 502, code: "OPS_WEBHOOK_FAILED", message: "ops webhook failed", expose: false });
    }
  }
}

export const safetyNotifier: SafetyNotifier = isProduction
  ? new LiveSafetyNotifier({ opsSmsNumbers: env.SOS_OPS_SMS_NUMBERS, opsWebhookUrl: env.SOS_OPS_WEBHOOK_URL })
  : new StubSafetyNotifier();
