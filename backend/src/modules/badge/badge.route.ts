import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { badgeService } from "./badge.service.js";
import {
  grantBadgeSchema,
  listingBadgeParamSchema,
  listingIdParamSchema,
  suspendBadgeSchema,
} from "./badge.schema.js";

/**
 * Admin badge controls. ADMIN-only (default-deny). An admin may GRANT only the
 * paid FEATURED badge and SUSPEND/unsuspend a badge with a logged reason — but
 * can NEVER fake-grant a rule badge (the service rejects any non-FEATURED grant).
 * Rule badges are earned/lost automatically by the engine, off these routes.
 */
export const badgeAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("ADMIN"));

  // View EVERY badge link on a listing (incl. suspended + scheduled) with the
  // reason each is held ("why") and its live active/inactive standing.
  app.get("/admin/listings/:id/badges", async (request) => {
    const { id } = listingIdParamSchema.parse(request.params);
    const badges = await badgeService.listForListing(id);
    return { listingId: id, badges };
  });

  // Grant a paid FEATURED placement (rule kinds are rejected by the service).
  app.post("/admin/listings/:id/badges", async (request, reply) => {
    const admin = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const body = grantBadgeSchema.parse(request.body);
    const badge = await badgeService.grant(admin, id, body, request.ip);
    return reply.status(201).send({ badge: serializeAdminBadge(badge) });
  });

  // Suspend a badge (logged reason). The engine will not re-earn it while suspended.
  app.post("/admin/listings/:id/badges/:kind/suspend", async (request) => {
    const admin = getAuthUser(request);
    const { id, kind } = listingBadgeParamSchema.parse(request.params);
    const { reason } = suspendBadgeSchema.parse(request.body);
    const badge = await badgeService.suspend(admin, id, kind, reason, request.ip);
    return { badge: serializeAdminBadge(badge) };
  });

  // Lift a suspension.
  app.post("/admin/listings/:id/badges/:kind/unsuspend", async (request) => {
    const admin = getAuthUser(request);
    const { id, kind } = listingBadgeParamSchema.parse(request.params);
    const badge = await badgeService.unsuspend(admin, id, kind, request.ip);
    return { badge: serializeAdminBadge(badge) };
  });
};

/** Admin view of a badge link (includes the suspension bookkeeping). */
function serializeAdminBadge(badge: {
  kind: string;
  source: string;
  earnedAt: Date;
  expiresAt: Date | null;
  suspended: boolean;
  suspendedReason: string | null;
}): Record<string, unknown> {
  return {
    kind: badge.kind,
    source: badge.source,
    earnedAt: badge.earnedAt.toISOString(),
    expiresAt: badge.expiresAt ? badge.expiresAt.toISOString() : null,
    suspended: badge.suspended,
    suspendedReason: badge.suspendedReason,
  };
}
