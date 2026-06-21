import { env, isProduction } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";

/**
 * SMS sending, behind an interface so it is trivially stubbable in tests and
 * swappable per environment. Production uses MSG91's flow API; non-production
 * uses a dev stub.
 */
export interface SmsSender {
  sendOtp(phone: string, code: string): Promise<void>;
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
}

export const smsSender: SmsSender = isProduction ? new Msg91SmsSender() : new DevSmsSender();
