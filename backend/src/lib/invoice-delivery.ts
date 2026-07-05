import type { InvoiceType } from "@roomadda/shared";
import { env, isProduction } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError } from "./errors.js";

/**
 * Invoice delivery (§15.7) — invoice PDFs go out over WhatsApp behind ONE
 * interface, the same env-gated stub/real seam as sms.ts / rent-reminder.ts.
 * Delivery is real via the MSG91 WhatsApp BSP when the integrated number + an
 * approved document template are configured (prod); otherwise it is a logged
 * stub, so dev/test never need a live key. Two campaigns share the seam:
 *  - "customer"  → the tenant's customer invoice
 *  - "pgowner"   → the PG owner's commission invoice (the "Comm" action)
 * PII (phone, name) is NEVER logged (see /CLAUDE.md); the stub logs only the
 * booking id, campaign, and byte count. Best-effort by contract — the caller
 * marks the invoice sent first and treats a throw as a retryable miss.
 */
export type InvoiceCampaign = "customer" | "pgowner";

export interface InvoiceDeliveryMessage {
  /** E.164 recipient (the tenant, or the PG owner for a commission invoice). */
  toPhone: string;
  recipientName: string;
  campaign: InvoiceCampaign;
  invoiceType: InvoiceType;
  bookingId: string;
  /** Attachment file name, e.g. "roomadda-invoice-<id>.pdf". */
  filename: string;
  /** The rendered invoice PDF bytes. */
  pdf: Uint8Array;
  /** Short human caption sent alongside the document. */
  caption: string;
}

export interface InvoiceDeliverer {
  sendInvoice(message: InvoiceDeliveryMessage): Promise<void>;
}

/**
 * Live WhatsApp document delivery via the MSG91 BSP (prod, only when the
 * integrated number + approved template are configured). Two-step, mirroring
 * Msg91's document flow: upload the PDF to obtain a media handle, then send the
 * approved template referencing it. authkey from env, never logged; a non-2xx is
 * a 502 the caller treats as a miss. [MANUAL] confirm the media/template field
 * names against the provisioned BSP number.
 */
class WhatsAppInvoiceDeliverer implements InvoiceDeliverer {
  async sendInvoice(message: InvoiceDeliveryMessage): Promise<void> {
    // Number without the leading '+', matching MSG91's WhatsApp recipient format.
    const to = message.toPhone.replace(/^\+/, "");

    // 1) Upload the PDF so WhatsApp can attach it as a document.
    const form = new FormData();
    form.append("file", new Blob([message.pdf], { type: "application/pdf" }), message.filename);
    const upload = await fetch("https://control.msg91.com/api/v5/whatsapp/upload-media", {
      method: "POST",
      headers: { authkey: env.MSG91_AUTH_KEY },
      body: form,
    });
    if (!upload.ok) {
      logger.error({ status: upload.status, campaign: message.campaign }, "MSG91 WhatsApp media upload failed");
      throw deliveryFailed();
    }
    const { id: mediaId } = (await upload.json()) as { id: string };

    // 2) Send the approved document template referencing the uploaded media.
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
            name: env.MSG91_WHATSAPP_INVOICE_TEMPLATE,
            language: { code: "en", policy: "deterministic" },
            to_and_components: [
              {
                to: [to],
                components: {
                  header_1: { type: "document", value: mediaId, filename: message.filename },
                  body_1: { type: "text", value: message.recipientName },
                  body_2: { type: "text", value: message.caption },
                },
              },
            ],
          },
        },
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, campaign: message.campaign }, "MSG91 WhatsApp invoice send failed");
      throw deliveryFailed();
    }
  }
}

/** Dev/test/unconfigured default: logs intent only (no PII), sends nothing. */
class StubInvoiceDeliverer implements InvoiceDeliverer {
  sendInvoice(message: InvoiceDeliveryMessage): Promise<void> {
    logger.info(
      {
        bookingId: message.bookingId,
        campaign: message.campaign,
        invoiceType: message.invoiceType,
        bytes: message.pdf.length,
      },
      "invoice WhatsApp delivery (stub — BSP not configured)",
    );
    return Promise.resolve();
  }
}

function deliveryFailed(): AppError {
  return new AppError({
    statusCode: 502,
    code: "INVOICE_DELIVERY_FAILED",
    message: "Failed to deliver invoice",
    expose: false,
  });
}

const invoiceBspConfigured = Boolean(env.MSG91_WHATSAPP_NUMBER && env.MSG91_WHATSAPP_INVOICE_TEMPLATE);

export const invoiceDeliverer: InvoiceDeliverer =
  isProduction && invoiceBspConfigured ? new WhatsAppInvoiceDeliverer() : new StubInvoiceDeliverer();
