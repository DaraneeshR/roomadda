/**
 * ERP-2 approvals (§15.3): the queue of pending bookings an admin reviews and
 * clears. "Review" opens the full KYC detail (erpBookingsService.detail); the
 * decision is one-tap approve/reject, recorded + audited, with a bulk-approve for
 * several clearly-fine requests. The queue is exactly the bookings whose derived
 * approval status is PENDING (a Request-to-Book hold awaiting a decision), so
 * neither approve nor reject can ever touch captured money — payment only unlocks
 * AFTER approval (the canonical live transition is bookingService.acceptBooking).
 * ADMIN-only (route-enforced).
 */
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { toPage } from "../../lib/pagination.js";
import { ledgerInclude, toLedgerEntry } from "./erp.bookings.service.js";
import type {
  BookingApprovalDecision,
  BookingApprovalsQuery,
  BookingApprovalsResponse,
  BookingBulkApproveResult,
} from "@roomadda/shared";

/** Payment window a tenant gets once a Request-to-Book is approved (mirrors
 *  bookingService.acceptBooking's ACCEPT_HOLD_TTL_MS — the canonical live path). */
const ACCEPT_HOLD_TTL_MS = 4 * 60 * 60 * 1000;

interface Actor {
  id: string;
}

const bookingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
const notPending = (): AppError =>
  new AppError({ statusCode: 409, code: "BOOKING_NOT_PENDING_APPROVAL", message: "Booking is not awaiting approval" });

export const erpApprovalsService = {
  /** The pending-decision queue (§15.3): Request-to-Book holds awaiting review,
   *  oldest first (act on the longest-waiting first), cursor-paginated. */
  async queue(query: BookingApprovalsQuery): Promise<BookingApprovalsResponse> {
    const rows = await prisma.booking.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: ledgerInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    // Pending bookings are never confirmed-paid, so they carry no commission.
    return { items: page.items.map((r) => toLedgerEntry(r)), nextCursor: page.nextCursor };
  },

  /**
   * Approve ONE pending booking: PENDING_APPROVAL → TOKEN_PENDING, unlocking the
   * tenant's payment window. NEVER confirms — confirmation still comes only from
   * the verified webhook (/CLAUDE.md). Audited.
   */
  async approve(actor: Actor, bookingId: string, ip?: string): Promise<BookingApprovalDecision> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
    if (!booking) throw bookingNotFound();
    if (booking.status !== "PENDING_APPROVAL") throw notPending();

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "TOKEN_PENDING", holdExpiresAt: new Date(Date.now() + ACCEPT_HOLD_TTL_MS) },
      select: { status: true },
    });
    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.approved",
      targetId: bookingId,
      ip,
      metadata: { before: "PENDING_APPROVAL", after: "TOKEN_PENDING" },
    });
    return { bookingId, approval: "APPROVED", bookingStatus: updated.status };
  },

  /**
   * Reject ONE pending booking: PENDING_APPROVAL → CANCELLED (cancelledBy = HOST,
   * the established staff-decline marker, so its derived approval reads REJECTED),
   * freeing the held bed. No refund path — a pending booking has no captured
   * payment. Runs in a transaction (booking + bed). Audited with the reason.
   */
  async reject(actor: Actor, bookingId: string, reason: string, ip?: string): Promise<BookingApprovalDecision> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { status: true, bedId: true },
    });
    if (!booking) throw bookingNotFound();
    if (booking.status !== "PENDING_APPROVAL") throw notPending();

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: "HOST",
          refundPaise: 0,
          refundReason: "ADMIN_REJECTED",
        },
        select: { status: true },
      });
      await tx.bed.update({ where: { id: booking.bedId }, data: { status: "AVAILABLE" } });
      return b;
    });
    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.rejected",
      targetId: bookingId,
      ip,
      metadata: { before: "PENDING_APPROVAL", after: "CANCELLED", reason },
    });
    return { bookingId, approval: "REJECTED", bookingStatus: updated.status };
  },

  /**
   * Bulk-approve several clearly-fine pending bookings. Only the ones still
   * PENDING_APPROVAL are approved (others are silently skipped). Runs in ONE
   * transaction (multi-row mutation) and writes ONE audit listing exactly which
   * bookings were approved.
   */
  async bulkApprove(actor: Actor, bookingIds: string[], ip?: string): Promise<BookingBulkApproveResult> {
    const eligible = await prisma.booking.findMany({
      where: { id: { in: bookingIds }, status: "PENDING_APPROVAL" },
      select: { id: true },
    });
    const eligibleIds = eligible.map((b) => b.id);

    if (eligibleIds.length > 0) {
      const holdExpiresAt = new Date(Date.now() + ACCEPT_HOLD_TTL_MS);
      await prisma.$transaction(
        eligibleIds.map((id) =>
          prisma.booking.update({
            where: { id },
            data: { status: "TOKEN_PENDING", holdExpiresAt },
          }),
        ),
      );
    }

    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.approved_bulk",
      ip,
      metadata: { requested: bookingIds.length, approved: eligibleIds.length, bookingIds: eligibleIds },
    });
    return { updated: eligibleIds.length, bookingIds: eligibleIds };
  },
};
