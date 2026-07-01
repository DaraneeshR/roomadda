import { env, isProduction } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";

/**
 * SMS sending, behind an interface so it is trivially stubbable in tests and
 * swappable per environment. Production uses MSG91's flow API; non-production
 * uses a dev stub.
 */
/** Everything one SOS SMS needs. `locationText` is a maps link or, when GPS is
 *  unavailable, a short "location unavailable" note (the alert still goes out). */
export interface SosSmsParams {
  /** E.164 recipient (a trusted contact). */
  toPhone: string;
  contactName: string;
  userName: string;
  locationText: string;
}

/** Everything one rent-reminder SMS needs. The SMS fallback for rent reminders
 *  when the WhatsApp BSP is not configured (see lib/rent-reminder.ts). */
export interface RentReminderSmsParams {
  /** E.164 tenant phone. */
  toPhone: string;
  tenantName: string;
  /** The masked listing alias (never the actualName — see /CLAUDE.md). */
  listingAlias: string;
  /** Formatted rupee amount, e.g. "₹12,000". */
  amountText: string;
  /** Due date, e.g. "15 Jul 2026". */
  dueDateText: string;
}

/** Everything one walk-in app-invite SMS needs. Sent to a tenant a host recorded
 *  as a walk-in, so they can claim their RoomAdda account pre-filled with this
 *  tenancy. Carries a single-use pre-registration token (the raw value goes out
 *  ONCE here; only its hash is stored). */
export interface WalkInInviteSmsParams {
  /** E.164 tenant phone. */
  toPhone: string;
  tenantName: string;
  /** The masked listing alias (never the actualName — see /CLAUDE.md). */
  listingAlias: string;
  /** Single-use pre-registration token (raw). Never stored, never logged. */
  registrationToken: string;
}

/** Everything one ops SOS SMS needs. Sent to an on-call ops number so the team
 *  can act on an emergency: who, their callback number, and where. */
export interface OpsSosSmsParams {
  /** E.164 ops on-call number. */
  toPhone: string;
  userName: string;
  /** The user's own number, so ops can call back immediately. */
  userPhone: string;
  locationText: string;
}

export interface SmsSender {
  sendOtp(phone: string, code: string): Promise<void>;
  /** Send an emergency SOS SMS to one trusted contact. */
  sendSos(params: SosSmsParams): Promise<void>;
  /** Send an SOS alert SMS to one ops on-call number. */
  sendOpsSos(params: OpsSosSmsParams): Promise<void>;
  /** Send a rent-due reminder SMS (WhatsApp-BSP fallback channel). */
  sendRentReminder(params: RentReminderSmsParams): Promise<void>;
  /** Send a walk-in tenant their app-invite with a pre-registration token. */
  sendWalkInInvite(params: WalkInInviteSmsParams): Promise<void>;
}

/** Live MSG91 sender (transactional flow API). */
export class Msg91SmsSender implements SmsSender {
  async sendOtp(phone: string, code: string): Promise<void> {
    if (!env.MSG91_OTP_TEMPLATE_ID) {
      throw new AppError({
        statusCode: 500,
        code: "SMS_NOT_CONFIGURED",
        message: "MSG91_OTP_TEMPLATE_ID is not set",
        expose: false,
      });
    }
    // MSG91 expects national numbers with country code, no leading '+'.
    const mobiles = phone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: env.MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: env.MSG91_OTP_TEMPLATE_ID,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        recipients: [{ mobiles, otp: code }],
      }),
    });
    if (!res.ok) {
      // Do NOT include the body verbatim in the client error; log server-side.
      logger.error({ status: res.status }, "MSG91 send failed");
      throw new AppError({
        statusCode: 502,
        code: "SMS_SEND_FAILED",
        message: "Failed to send OTP",
        expose: true,
      });
    }
  }

  async sendSos(params: SosSmsParams): Promise<void> {
    if (!env.MSG91_SOS_TEMPLATE_ID) {
      throw new AppError({
        statusCode: 500,
        code: "SMS_NOT_CONFIGURED",
        message: "MSG91_SOS_TEMPLATE_ID is not set",
        expose: false,
      });
    }
    const mobiles = params.toPhone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_SOS_TEMPLATE_ID,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        recipients: [{ mobiles, name: params.contactName, user: params.userName, location: params.locationText }],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "MSG91 SOS send failed");
      throw new AppError({ statusCode: 502, code: "SMS_SEND_FAILED", message: "Failed to send SOS SMS", expose: true });
    }
  }

  async sendOpsSos(params: OpsSosSmsParams): Promise<void> {
    if (!env.MSG91_SOS_OPS_TEMPLATE_ID) {
      throw new AppError({
        statusCode: 500,
        code: "SMS_NOT_CONFIGURED",
        message: "MSG91_SOS_OPS_TEMPLATE_ID is not set",
        expose: false,
      });
    }
    const mobiles = params.toPhone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_SOS_OPS_TEMPLATE_ID,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        recipients: [{ mobiles, user: params.userName, phone: params.userPhone, location: params.locationText }],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "MSG91 ops SOS send failed");
      throw new AppError({ statusCode: 502, code: "SMS_SEND_FAILED", message: "Failed to send ops SOS SMS", expose: true });
    }
  }

  async sendRentReminder(params: RentReminderSmsParams): Promise<void> {
    if (!env.MSG91_RENT_REMINDER_TEMPLATE_ID) {
      throw new AppError({
        statusCode: 500,
        code: "SMS_NOT_CONFIGURED",
        message: "MSG91_RENT_REMINDER_TEMPLATE_ID is not set",
        expose: false,
      });
    }
    const mobiles = params.toPhone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_RENT_REMINDER_TEMPLATE_ID,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        recipients: [
          { mobiles, name: params.tenantName, listing: params.listingAlias, amount: params.amountText, due: params.dueDateText },
        ],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "MSG91 rent reminder send failed");
      throw new AppError({ statusCode: 502, code: "SMS_SEND_FAILED", message: "Failed to send rent reminder SMS", expose: true });
    }
  }

  async sendWalkInInvite(params: WalkInInviteSmsParams): Promise<void> {
    if (!env.MSG91_WALKIN_INVITE_TEMPLATE_ID) {
      throw new AppError({
        statusCode: 500,
        code: "SMS_NOT_CONFIGURED",
        message: "MSG91_WALKIN_INVITE_TEMPLATE_ID is not set",
        expose: false,
      });
    }
    const mobiles = params.toPhone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_WALKIN_INVITE_TEMPLATE_ID,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        recipients: [
          { mobiles, name: params.tenantName, listing: params.listingAlias, token: params.registrationToken },
        ],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "MSG91 walk-in invite send failed");
      throw new AppError({ statusCode: 502, code: "SMS_SEND_FAILED", message: "Failed to send walk-in invite SMS", expose: true });
    }
  }
}

/**
 * Dev stub. Logs the code so local flows can complete WITHOUT an SMS gateway.
 * Guarded to non-production only; the live sender never logs the code.
 */
export class DevSmsSender implements SmsSender {
  sendOtp(phone: string, code: string): Promise<void> {
    logger.warn(`DEV_OTP ${phone} ${code} (dev stub — not sent via SMS)`);
    return Promise.resolve();
  }

  sendSos(params: SosSmsParams): Promise<void> {
    // Emergency dev log — confirms the path fired without a real gateway.
    logger.warn(`DEV_SOS to ${params.toPhone} for ${params.userName} (dev stub — not sent via SMS)`);
    return Promise.resolve();
  }

  sendOpsSos(params: OpsSosSmsParams): Promise<void> {
    logger.warn(`DEV_SOS_OPS to ${params.toPhone} re ${params.userName} (dev stub — not sent via SMS)`);
    return Promise.resolve();
  }

  sendRentReminder(params: RentReminderSmsParams): Promise<void> {
    logger.warn(`DEV_RENT_REMINDER to ${params.toPhone} due ${params.dueDateText} (dev stub — not sent via SMS)`);
    return Promise.resolve();
  }

  sendWalkInInvite(params: WalkInInviteSmsParams): Promise<void> {
    // Never log the raw token — only confirm the path fired.
    logger.warn(`DEV_WALKIN_INVITE to ${params.toPhone} for ${params.listingAlias} (dev stub — not sent via SMS)`);
    return Promise.resolve();
  }
}

export const smsSender: SmsSender = isProduction ? new Msg91SmsSender() : new DevSmsSender();
