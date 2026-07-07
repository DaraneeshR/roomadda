import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Confirm a HELD hotel reservation from a verified, captured Razorpay webhook,
 * inside its transaction. This is the ONLY place a reservation becomes CONFIRMED
 * (payment truth = verified webhook — /CLAUDE.md rule #2), and — like a rent
 * invoice — ONLY a FULL-amount capture confirms it. Matched by the unique
 * `razorpayOrderId`. Idempotent: an already-CONFIRMED reservation is a no-op, and
 * a CANCELLED/EXPIRED one is never resurrected. Kept import-light (like
 * markRentInvoicePaidByOrder / markAdPaidByOrder) so the webhook handler stays
 * lean. Returns the reservation id when THIS call confirmed it, else null.
 *
 * On confirm it mints the check-in `qrCodeToken` (the client renders the QR).
 * Availability needs no explicit decrement: a CONFIRMED reservation is LIVE, so it
 * is already excluded from every availability query (the same set the overbooking
 * guard enforces).
 */
export async function markHotelReservationPaidByOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  entity: { id?: string; amount?: number } | undefined,
  webhookEventId: string | null,
): Promise<string | null> {
  const reservation = await tx.hotelReservation.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, status: true, tokenAmountPaise: true },
  });
  if (!reservation) return null; // not a hotel order
  if (reservation.status === "CONFIRMED") return null; // already applied — idempotent no-op
  if (reservation.status !== "HELD") return null; // CANCELLED/EXPIRED — never resurrect

  // Full payment only — never confirm a stay on a partial capture.
  const capturedPaise = entity?.amount ?? 0;
  if (capturedPaise < reservation.tokenAmountPaise) return null;

  await tx.hotelReservation.update({
    where: { id: reservation.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      razorpayPaymentId: entity?.id ?? null,
      webhookEventId,
      qrCodeToken: `hqr_${randomUUID().replace(/-/g, "")}`,
    },
  });
  return reservation.id;
}
