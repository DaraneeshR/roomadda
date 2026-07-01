import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { broadcastService } from "./broadcast.service.js";
import { requireOwnedListing } from "./ownership.js";
import { listingIdParamSchema, broadcastSchema } from "./host.schema.js";

/**
 * Host broadcast — one message to all current tenants of a property (max 280
 * chars, 3/day). HOST/ADMIN, ownership-scoped. The message is mirrored into each
 * current tenant's chat thread; ex-tenants never receive it.
 */
export const broadcastRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  app.post("/host/listings/:id/broadcast", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const { body } = broadcastSchema.parse(request.body);
    const result = await broadcastService.send(id, user.id, body);
    return reply.status(201).send(result);
  });
};
