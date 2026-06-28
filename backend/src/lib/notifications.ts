import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export interface BookingConfirmedNotice {
  bookingId: string;
  tenantName: string;
  tenantPhone: string;
  hostName: string;
  hostPhone: string;
  listingName: string;
  moveInDate: Date | null;
}

/**
 * Outbound booking notifications: a WhatsApp template to the tenant and a push
 * to the host on confirmation. The BSP/push providers sit behind this interface
 * so they're wired now and become real once keys are registered (see /CLAUDE.md:
 * secrets via env; PII never logged).
 */
export interface BookingNotifier {
  bookingConfirmed(notice: BookingConfirmedNotice): Promise<void>;
}

/** Dev/unregistered default: logs intent only (no PII), sends nothing. */
class StubBookingNotifier implements BookingNotifier {
  async bookingConfirmed(notice: BookingConfirmedNotice): Promise<void> {
    logger.info(
      { bookingId: notice.bookingId, channels: "whatsapp(tenant)+push(host)" },
      "booking confirmed notification (stub — BSP/push not registered)",
    );
  }
}

export const bookingNotifier: BookingNotifier = new StubBookingNotifier();

/**
 * Best-effort: load the data a confirmed-booking notification needs and dispatch
 * it. Called AFTER the settlement transaction commits. Never throws — a
 * notification failure must not affect the webhook/settlement result.
 */
export async function notifyBookingConfirmed(bookingId: string): Promise<void> {
  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        moveInDate: true,
        tenant: { select: { fullName: true, phone: true } },
        listing: { select: { alias: true, host: { select: { fullName: true, phone: true } } } },
      },
    });
    if (!b) return;
    await bookingNotifier.bookingConfirmed({
      bookingId: b.id,
      tenantName: b.tenant.fullName,
      tenantPhone: b.tenant.phone,
      hostName: b.listing.host.fullName,
      hostPhone: b.listing.host.phone,
      listingName: b.listing.alias,
      moveInDate: b.moveInDate,
    });
  } catch (err) {
    logger.error({ err, bookingId }, "failed to send booking-confirmed notification");
  }
}
