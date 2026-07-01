import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { rosterService } from "./roster.service.js";
import { requireOwnedListing } from "./ownership.js";
import { listingIdParamSchema, rosterQuerySchema } from "./host.schema.js";

/**
 * Tenant roster for a listing — current (default) or past tenants. HOST/ADMIN,
 * ownership-scoped: a host only ever sees their OWN property's roster, and each
 * entry carries no KYC and no other tenant's data.
 */
export const rosterRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  app.get("/host/listings/:id/roster", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const { scope, limit } = rosterQuerySchema.parse(request.query);
    const items = scope === "past" ? await rosterService.past(id, limit) : await rosterService.current(id, limit);
    // A per-listing roster is bounded by inventory, so it is one page.
    return reply.send({ items, nextCursor: null });
  });
};
