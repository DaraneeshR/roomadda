import { prisma } from "../../lib/prisma.js";
import { activeStayInclude, type ActiveStayBooking } from "./stay.serializer.js";

/**
 * Active-stay reads for the post-move-in tenant dashboard. A stay is "active"
 * only when the caller's OWN booking is CONFIRMED and its move-in date has
 * arrived (moveInDate <= now). Anything else — pre-move-in, unpaid, cancelled,
 * or another tenant's booking — yields no stay.
 */
export const stayService = {
  /**
   * The caller's current active stay, or null. Scoped to `tenantId`, so it can
   * never surface another tenant's booking. If a tenant somehow has multiple
   * live confirmed stays, the most recent move-in wins.
   */
  async getActiveStay(tenantId: string, now: Date): Promise<ActiveStayBooking | null> {
    return prisma.booking.findFirst({
      where: {
        tenantId,
        status: "CONFIRMED",
        // `lte` already excludes null move-in dates; no separate guard needed.
        moveInDate: { lte: now },
      },
      orderBy: { moveInDate: "desc" },
      include: activeStayInclude,
    });
  },
};
