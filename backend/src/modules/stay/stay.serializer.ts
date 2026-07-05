import { Prisma } from "@prisma/client";
import type { ActiveStay } from "@roomadda/shared";

/**
 * Active-stay serializer for the post-move-in tenant dashboard (GET
 * /v1/me/active-stay). The caller is always a CONFIRMED tenant on this listing,
 * so the real PG name is allowed (see /CLAUDE.md domain rule #4). The host's
 * emergency contact (phone) IS surfaced here — the PRD permits it on the
 * dashboard, but NOT in chat. The shape carries NO KYC or payment data.
 */

/** Relations needed to serialize a tenant's active stay. */
export const activeStayInclude = {
  bed: { include: { room: { select: { name: true } } } },
  listing: {
    select: { actualName: true, host: { select: { fullName: true, phone: true } } },
  },
} satisfies Prisma.BookingInclude;

export type ActiveStayBooking = Prisma.BookingGetPayload<{ include: typeof activeStayInclude }>;

/**
 * Next monthly rent due date: the first monthly anniversary of the move-in date
 * that falls strictly after `now`. (Day-of-month overflow — e.g. the 31st in a
 * short month — rolls forward per JS Date semantics; acceptable for an MVP
 * estimate until a rent-schedule model exists.)
 */
export function nextRentDueDate(moveInDate: Date, now: Date): Date {
  const due = new Date(moveInDate);
  while (due <= now) {
    due.setMonth(due.getMonth() + 1);
  }
  return due;
}

export function toActiveStay(booking: ActiveStayBooking, now: Date): ActiveStay {
  // Guaranteed by the service query (moveInDate <= now), but assert for the type.
  const moveIn = booking.moveInDate;
  if (!moveIn) {
    throw new Error("active stay booking has no moveInDate");
  }
  return {
    bookingId: booking.id,
    listingId: booking.listingId,
    pgName: booking.listing.actualName,
    roomName: booking.bed.room.name,
    moveInDate: moveIn.toISOString(),
    monthlyRentPaise: booking.monthlyRentPaise,
    nextRentDueDate: nextRentDueDate(moveIn, now).toISOString(),
    host: {
      name: booking.listing.host.fullName,
      // Allowed on the dashboard per PRD (host contact) — never exposed in chat.
      emergencyContactNumber: booking.listing.host.phone!, // a host is a phone-OTP user
    },
    features: {
      // The meal menu is offered once the tenant has opted into a meal plan.
      mealMenuAvailable: booking.mealPlan != null,
      // A leave notice can always be raised against an active stay.
      leaveNoticeAvailable: true,
    },
  };
}
