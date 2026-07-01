import { env, isProduction } from "../config/env.js";
import { formatPaise } from "./money.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";
import { smsSender } from "./sms.js";

/**
 * Rent-reminder messaging, behind one interface so callers stay simple and tests
 * can spy on the method — the same env-gated stub/real pattern as sms.ts /
 * chat-transport.ts. Delivery preference: a WhatsApp template via the MSG91 BSP
 * when it is configured (prod), otherwise an SMS fallback (which is itself the
 * dev no-op via DevSmsSender). Masking holds: only the listing ALIAS is sent,
 * never the actualName (see /CLAUDE.md). Best-effort by contract — the caller
 * records the window first and treats a throw as a retryable miss.
 */
export interface RentReminderMessage {
  /** E.164 tenant phone. */
  toPhone: string;
  tenantName: string;
  /** Masked listing alias (public-safe). */
  listingAlias: string;
  /** Billing month label, e.g. "July 2026". */
  periodLabel: string;
  amountPaise: number;
  dueDate: Date;
  /** The window's lead time in days (5 or 1) — drives the copy variant. */
  daysBeforeDue: number;
}

export interface RentReminderNotifier {
  sendRentReminder(message: RentReminderMessage): Promise<void>;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Render a due date as a short UTC label, e.g. "15 Jul 2026". */
function dueDateText(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** SMS fallback: reuse the shared SMS sender (live MSG91 flow in prod, dev stub
 *  otherwise — so this path is also the "no-op in dev"). */
class SmsRentReminderNotifier implements RentReminderNotifier {
  async sendRentReminder(message: RentReminderMessage): Promise<void> {
    await smsSender.sendRentReminder({
      toPhone: message.toPhone,
      tenantName: message.tenantName,
      listingAlias: message.listingAlias,
      amountText: formatPaise(message.amountPaise),
      dueDateText: dueDateText(message.dueDate),
    });
  }
}

/**
 * Live WhatsApp template via the MSG91 BSP (used only in prod, only when the
 * integrated number + approved template are configured). Mirrors Msg91SmsSender:
 * authkey from env, never logged; a non-2xx is a 502 the caller treats as a miss.
 */
class WhatsAppRentReminderNotifier implements RentReminderNotifier {
  async sendRentReminder(message: RentReminderMessage): Promise<void> {
    // Number without the leading '+', matching MSG91's WhatsApp recipient format.
    const to = message.toPhone.replace(/^\+/, "");
    const res = await fetch("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        integrated_number: env.MSG91_WHATSAPP_NUMBER,
        content_type: "template",
        payload: {
          messaging_product: "whatsapp",
          type: "template",
          template: {
            name: env.MSG91_WHATSAPP_RENT_TEMPLATE,
            language: { code: "en", policy: "deterministic" },
            to_and_components: [
              {
                to: [to],
                components: {
                  body_1: { type: "text", value: message.tenantName },
                  body_2: { type: "text", value: message.listingAlias },
                  body_3: { type: "text", value: formatPaise(message.amountPaise) },
                  body_4: { type: "text", value: dueDateText(message.dueDate) },
                },
              },
            ],
          },
        },
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "MSG91 WhatsApp rent reminder send failed");
      throw new AppError({ statusCode: 502, code: "RENT_REMINDER_SEND_FAILED", message: "Failed to send rent reminder", expose: false });
    }
  }
}

const whatsappBspConfigured = Boolean(env.MSG91_WHATSAPP_NUMBER && env.MSG91_WHATSAPP_RENT_TEMPLATE);

export const rentReminderNotifier: RentReminderNotifier =
  isProduction && whatsappBspConfigured ? new WhatsAppRentReminderNotifier() : new SmsRentReminderNotifier();
