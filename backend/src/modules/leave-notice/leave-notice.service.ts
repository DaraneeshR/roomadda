import type { LeaveNotice } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { safetyNotifier } from "../../lib/safety-notify.js";
import { stayService } from "../stay/stay.service.js";
import {
  NOTICE_PERIOD_DAYS,
  canWithdrawNotice,
  earliestMoveOutDate,
  isMoveOutDateValid,
} from "./leave-notice.logic.js";

const notFound = () =>
  new AppError({ statusCode: 404, code: "LEAVE_NOTICE_NOT_FOUND", message: "Leave notice not found" });

/** Load notify data and dispatch the host + admin notice (best-effort). */
async function notifyLeaveNotice(notice: LeaveNotice): Promise<void> {
  const [listing, tenant] = await Promise.all([
    prisma.pgListing.findUnique({
      where: { id: notice.listingId },
      select: { alias: true, hostId: true, host: { select: { fullName: true } } },
    }),
    prisma.user.findUnique({ where: { id: notice.tenantId }, select: { fullName: true } }),
  ]);
  if (!listing || !tenant) return;
  await safetyNotifier.leaveNoticeSubmitted({
    noticeId: notice.id,
    tenantName: tenant.fullName,
    listingAlias: listing.alias,
    hostId: listing.hostId,
    hostName: listing.host.fullName,
    moveOutDate: notice.moveOutDate,
  });
}

export const leaveNoticeService = {
  noticePeriodDays: NOTICE_PERIOD_DAYS,

  earliestMoveOutDate(now: Date = new Date()): Date {
    return earliestMoveOutDate(now);
  },

  /**
   * Serve notice. REQUIRES an active stay; the move-out date must be at least the
   * notice period out; only one ACTIVE notice per booking. On submit (one
   * transaction) the bed is flagged Vacating Soon, then host + admin are notified.
   */
  async submit(tenantId: string, moveOutDate: Date): Promise<LeaveNotice> {
    const now = new Date();
    const stay = await stayService.getActiveStay(tenantId, now);
    if (!stay) {
      throw new AppError({ statusCode: 403, code: "NO_ACTIVE_STAY", message: "An active stay is required to serve notice" });
    }
    if (!isMoveOutDateValid(moveOutDate, now)) {
      throw new AppError({
        statusCode: 422,
        code: "NOTICE_PERIOD_NOT_MET",
        message: `Move-out must be at least ${NOTICE_PERIOD_DAYS} days away`,
        details: { noticePeriodDays: NOTICE_PERIOD_DAYS, earliestMoveOutDate: earliestMoveOutDate(now).toISOString() },
      });
    }
    const existing = await prisma.leaveNotice.findFirst({
      where: { bookingId: stay.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (existing) {
      throw new AppError({ statusCode: 409, code: "NOTICE_EXISTS", message: "You already have an active leave notice" });
    }

    const notice = await prisma.$transaction(async (tx) => {
      const created = await tx.leaveNotice.create({
        data: { bookingId: stay.id, tenantId, listingId: stay.listingId, bedId: stay.bedId, moveOutDate, status: "ACTIVE" },
      });
      // Queue the bed as Vacating Soon — it frees on the move-out date.
      await tx.bed.update({ where: { id: stay.bedId }, data: { vacatingSoon: true, vacatingFrom: moveOutDate } });
      return created;
    });

    await notifyLeaveNotice(notice).catch((err) => logger.error({ err, noticeId: notice.id }, "leave notice notify failed"));
    await writeAudit({
      actorId: tenantId,
      action: "leave_notice.submitted",
      targetId: notice.id,
      metadata: { moveOutDate: moveOutDate.toISOString() },
    });
    return notice;
  },

  /** The caller's own notices, newest first. */
  async listForTenant(tenantId: string): Promise<LeaveNotice[]> {
    return prisma.leaveNotice.findMany({ where: { tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  },

  /**
   * Withdraw an ACTIVE notice. Blocked within 3 days of move-out. Clears the
   * bed's Vacating Soon flag in the same transaction. 404 if not the caller's.
   */
  async withdraw(tenantId: string, noticeId: string): Promise<LeaveNotice> {
    const notice = await prisma.leaveNotice.findUnique({ where: { id: noticeId } });
    if (!notice || notice.tenantId !== tenantId) throw notFound();
    if (notice.status !== "ACTIVE") {
      throw new AppError({ statusCode: 409, code: "NOTICE_NOT_ACTIVE", message: "This notice is no longer active" });
    }
    if (!canWithdrawNotice(notice.moveOutDate, new Date())) {
      throw new AppError({ statusCode: 409, code: "WITHDRAW_LOCKED", message: "A notice cannot be withdrawn within 3 days of move-out" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const n = await tx.leaveNotice.update({
        where: { id: noticeId },
        data: { status: "WITHDRAWN", withdrawnAt: new Date() },
      });
      await tx.bed.update({ where: { id: notice.bedId }, data: { vacatingSoon: false, vacatingFrom: null } });
      return n;
    });
    await writeAudit({ actorId: tenantId, action: "leave_notice.withdrawn", targetId: noticeId });
    return updated;
  },
};
