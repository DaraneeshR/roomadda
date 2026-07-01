import type { LeaveNotice } from "@prisma/client";
import type { LeaveNotice as LeaveNoticeDTO } from "@roomadda/shared";
import { canWithdrawNotice } from "./leave-notice.logic.js";

/** `canWithdraw` is computed: true only while ACTIVE and outside the 3-day lock. */
export function toLeaveNotice(n: LeaveNotice, now: Date): LeaveNoticeDTO {
  return {
    id: n.id,
    moveOutDate: n.moveOutDate.toISOString(),
    status: n.status,
    canWithdraw: n.status === "ACTIVE" && canWithdrawNotice(n.moveOutDate, now),
    withdrawnAt: n.withdrawnAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
