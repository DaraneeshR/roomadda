import { Prisma } from "@prisma/client";
import type { RosterRentStatus, RosterTenant } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * Host tenant roster. CURRENT tenants are CONFIRMED platform bookings plus
 * still-resident walk-ins; PAST tenants are ended bookings + checked-out walk-ins
 * (with move-out + duration). Every entry carries ONLY that tenant's name, room,
 * move-in, and rent status — NEVER KYC and NEVER another tenant's data
 * (/CLAUDE.md domain rule #4 + the host privacy requirement). A per-listing roster
 * is bounded by the property's inventory, so it returns as a single page.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const bookingRosterInclude = {
  tenant: { select: { fullName: true } }, // fullName ONLY — no phone, no kyc
  bed: { select: { room: { select: { name: true } } } },
} satisfies Prisma.BookingInclude;

/** Effective rent status for a booking from its invoices (none owed => PAID). */
function rentStatusFor(
  invoices: { status: string; dueDate: Date; paidAt: Date | null }[],
  now: Date,
): RosterRentStatus {
  let hasDue = false;
  for (const inv of invoices) {
    if (inv.status === "PAID" || inv.paidAt) continue;
    if (inv.dueDate.getTime() < now.getTime()) return "OVERDUE";
    hasDue = true;
  }
  return hasDue ? "DUE" : "PAID";
}

function durationDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

export const rosterService = {
  /** Current roster for a listing (ownership enforced by the route). */
  async current(listingId: string, limit: number): Promise<RosterTenant[]> {
    const now = new Date();
    const [bookings, walkIns] = await Promise.all([
      prisma.booking.findMany({
        where: { listingId, status: "CONFIRMED" },
        include: bookingRosterInclude,
        orderBy: { moveInDate: "desc" },
      }),
      prisma.walkInTenant.findMany({
        where: { listingId, checkedOutAt: null },
        include: { room: { select: { name: true } } },
        orderBy: { moveInDate: "desc" },
      }),
    ]);

    const rentByBooking = await this.rentStatusByBooking(bookings.map((b) => b.id), now);

    const bookingEntries: RosterTenant[] = bookings.map((b) => ({
      kind: "BOOKING",
      id: b.id,
      name: b.tenant.fullName,
      roomName: b.bed.room.name,
      moveInDate: b.moveInDate?.toISOString() ?? null,
      monthlyRentPaise: b.monthlyRentPaise,
      rentStatus: rentByBooking.get(b.id) ?? "PAID",
      moveOutDate: null,
      durationDays: null,
    }));

    const walkInEntries: RosterTenant[] = walkIns.map((w) => ({
      kind: "WALK_IN",
      id: w.id,
      name: w.name,
      roomName: w.room.name,
      moveInDate: w.moveInDate.toISOString(),
      monthlyRentPaise: w.monthlyRentPaise,
      rentStatus: "NOT_TRACKED",
      moveOutDate: null,
      durationDays: null,
    }));

    return [...bookingEntries, ...walkInEntries]
      .sort((a, b) => (b.moveInDate ?? "").localeCompare(a.moveInDate ?? ""))
      .slice(0, limit);
  },

  /** Past roster for a listing — ended bookings + checked-out walk-ins. */
  async past(listingId: string, limit: number): Promise<RosterTenant[]> {
    const [bookings, walkIns] = await Promise.all([
      prisma.booking.findMany({
        where: { listingId, status: { in: ["COMPLETED", "CANCELLED"] } },
        include: bookingRosterInclude,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.walkInTenant.findMany({
        where: { listingId, checkedOutAt: { not: null } },
        include: { room: { select: { name: true } } },
        orderBy: { checkedOutAt: "desc" },
      }),
    ]);

    const bookingEntries: RosterTenant[] = bookings.map((b) => {
      const moveOut = b.cancelledAt ?? b.updatedAt;
      return {
        kind: "BOOKING",
        id: b.id,
        name: b.tenant.fullName,
        roomName: b.bed.room.name,
        moveInDate: b.moveInDate?.toISOString() ?? null,
        monthlyRentPaise: b.monthlyRentPaise,
        rentStatus: "NOT_TRACKED",
        moveOutDate: moveOut.toISOString(),
        durationDays: b.moveInDate ? durationDays(b.moveInDate, moveOut) : null,
      };
    });

    const walkInEntries: RosterTenant[] = walkIns.map((w) => {
      const moveOut = w.checkedOutAt!;
      return {
        kind: "WALK_IN",
        id: w.id,
        name: w.name,
        roomName: w.room.name,
        moveInDate: w.moveInDate.toISOString(),
        monthlyRentPaise: w.monthlyRentPaise,
        rentStatus: "NOT_TRACKED",
        moveOutDate: moveOut.toISOString(),
        durationDays: durationDays(w.moveInDate, moveOut),
      };
    });

    return [...bookingEntries, ...walkInEntries]
      .sort((a, b) => (b.moveOutDate ?? "").localeCompare(a.moveOutDate ?? ""))
      .slice(0, limit);
  },

  /** Batch the effective rent status for many bookings in one invoice query. */
  async rentStatusByBooking(bookingIds: string[], now: Date): Promise<Map<string, RosterRentStatus>> {
    const map = new Map<string, RosterRentStatus>();
    if (bookingIds.length === 0) return map;
    const invoices = await prisma.rentInvoice.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { bookingId: true, status: true, dueDate: true, paidAt: true },
    });
    const grouped = new Map<string, { status: string; dueDate: Date; paidAt: Date | null }[]>();
    for (const inv of invoices) {
      const list = grouped.get(inv.bookingId) ?? [];
      list.push(inv);
      grouped.set(inv.bookingId, list);
    }
    for (const id of bookingIds) map.set(id, rentStatusFor(grouped.get(id) ?? [], now));
    return map;
  },
};
