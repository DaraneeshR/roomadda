import { Prisma, type BookingStatus } from "@prisma/client";
import type { HostBookingRequest } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { toPage, type Page } from "../../lib/pagination.js";

/**
 * Host "incoming bookings" feed. Request-to-Book holds (PENDING_APPROVAL) are
 * actionable with a 24h countdown; Instant-Book bookings appear already-confirmed.
 * The host NEVER sees the tenant's KYC documents — the include selects ONLY the
 * tenant's display name, so no KYC can leak through the serializer (/CLAUDE.md
 * domain rule #4 + the host privacy requirement).
 */

/** Default feed: pending requests (actionable) + confirmed instant bookings. */
const DEFAULT_STATUSES: BookingStatus[] = ["PENDING_APPROVAL", "CONFIRMED"];

// Tenant: fullName ONLY. No phone, no kyc relation — the host cannot see them.
const requestInclude = {
  tenant: { select: { fullName: true } },
  bed: { select: { label: true, room: { select: { name: true } } } },
  listing: { select: { instantBook: true } },
} satisfies Prisma.BookingInclude;

export type BookingRequestRow = Prisma.BookingGetPayload<{ include: typeof requestInclude }>;

export function toHostBookingRequest(b: BookingRequestRow, now: Date = new Date()): HostBookingRequest {
  const isPending = b.status === "PENDING_APPROVAL";
  const expiresAt = isPending ? b.holdExpiresAt : null;
  const secondsRemaining =
    isPending && expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;
  return {
    bookingId: b.id,
    listingId: b.listingId,
    status: b.status,
    instant: b.listing.instantBook,
    tenantName: b.tenant.fullName,
    roomName: b.bed.room.name,
    bedLabel: b.bed.label,
    tokenAmountPaise: b.tokenAmountPaise,
    monthlyRentPaise: b.monthlyRentPaise,
    moveInDate: b.moveInDate?.toISOString() ?? null,
    requestedAt: b.createdAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    secondsRemaining,
  };
}

export const bookingRequestService = {
  /**
   * Incoming bookings across the host's listings (ADMIN sees all), newest first,
   * cursor-paginated. Scoped via the listing's hostId so a host only ever sees
   * requests on their own properties.
   */
  async listIncoming(
    actor: { id: string; role: string },
    query: { status?: BookingStatus; cursor?: string; limit: number },
  ): Promise<Page<BookingRequestRow>> {
    const where: Prisma.BookingWhereInput = {
      ...(actor.role === "ADMIN" ? {} : { listing: { hostId: actor.id } }),
      status: query.status ? query.status : { in: DEFAULT_STATUSES },
    };
    const rows = await prisma.booking.findMany({
      where,
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  },
};
