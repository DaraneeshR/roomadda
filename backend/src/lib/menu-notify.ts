import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

/**
 * Meal-menu notifications, behind an env-agnostic interface (the same Stub/Live
 * seam as notify.ts / safety-notify.ts). Two best-effort signals:
 *   - a SILENT data-only push to a listing's active tenants when the host updates
 *     the menu (the tenant app refreshes the menu card; no alert banner), and
 *   - a 7am reminder to a host whose menu is empty for the day.
 * Best-effort by contract: a failure here NEVER breaks the host action / sweep.
 * PII is never logged (see /CLAUDE.md).
 */
export interface MenuNotifier {
  /** Silent refresh signal to a listing's active tenants. */
  menuUpdated(notice: { listingId: string; tenantIds: string[] }): Promise<void>;
  /** Nudge a host whose menu is still empty at 7am. */
  emptyMenuReminder(notice: { listingId: string; hostId: string }): Promise<void>;
}

/** Dev/default notifier: logs intent only (no push provider). */
class StubMenuNotifier implements MenuNotifier {
  menuUpdated(notice: { listingId: string; tenantIds: string[] }): Promise<void> {
    logger.info(
      { listingId: notice.listingId, recipients: notice.tenantIds.length },
      "menu updated — silent push to active tenants (stub)",
    );
    return Promise.resolve();
  }

  emptyMenuReminder(notice: { listingId: string; hostId: string }): Promise<void> {
    logger.info({ listingId: notice.listingId }, "empty-menu 7am reminder (stub)");
    return Promise.resolve();
  }
}

export const menuNotifier: MenuNotifier = new StubMenuNotifier();

/**
 * Resolve a listing's active tenants (distinct CONFIRMED-booking tenants) and
 * fire the silent menu-update push. Best-effort: never throws to the caller.
 */
export async function notifyMenuUpdated(listingId: string): Promise<void> {
  try {
    const bookings = await prisma.booking.findMany({
      where: { listingId, status: "CONFIRMED" },
      select: { tenantId: true },
      distinct: ["tenantId"],
    });
    if (bookings.length === 0) return;
    await menuNotifier.menuUpdated({ listingId, tenantIds: bookings.map((b) => b.tenantId) });
  } catch (err) {
    logger.error({ err, listingId }, "failed to push silent menu update");
  }
}
