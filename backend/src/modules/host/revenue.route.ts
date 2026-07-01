import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { revenueService } from "./revenue.service.js";
import { requireOwnedListing } from "./ownership.js";
import { listingIdParamSchema } from "./host.schema.js";

/**
 * Host revenue — read-only expected/collected/overdue + occupancy + last-3-months
 * chart for a listing. HOST/ADMIN, ownership-scoped. NO payouts in MVP.
 */
export const revenueRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  app.get("/host/listings/:id/revenue", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    return reply.send(await revenueService.summary(id));
  });
};
