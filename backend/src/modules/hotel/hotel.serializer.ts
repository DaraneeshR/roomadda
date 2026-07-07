import type { HotelReservation as HotelReservationRow } from "@prisma/client";
import type { HotelReservation } from "@roomadda/shared";

/** ISO date-only (yyyy-mm-dd) for a @db.Date column (stored at UTC midnight). */
const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Serialize a reservation for its guest. Money + dates are exactly the server-owned
 * snapshot; `qrCodeToken` is present only once CONFIRMED (minted by the webhook).
 */
export function toHotelReservation(r: HotelReservationRow): HotelReservation {
  return {
    id: r.id,
    listingId: r.listingId,
    categoryId: r.categoryId,
    status: r.status,
    checkIn: toDateOnly(r.checkIn),
    checkOut: toDateOnly(r.checkOut),
    nights: r.nights,
    perNightPaise: r.perNightPaise,
    roomTotalPaise: r.roomTotalPaise,
    tokenAmountPaise: r.tokenAmountPaise,
    holdExpiresAt: r.holdExpiresAt?.toISOString() ?? null,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    qrCodeToken: r.qrCodeToken,
    createdAt: r.createdAt.toISOString(),
  };
}
