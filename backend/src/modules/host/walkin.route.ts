import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { walkInService, toWalkIn } from "./walkin.service.js";
import { requireOwnedListing } from "./ownership.js";
import { listingIdParamSchema, walkInParamSchema, walkInQuerySchema, createWalkInSchema } from "./host.schema.js";

/**
 * Walk-in entry + roster of walk-ins. All HOST/ADMIN, ownership-scoped. Creating a
 * walk-in reduces room availability (blocks a bed) and fires the app-invite SMS;
 * the Aadhaar number the host typed is never returned in full.
 */
export const walkInRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  // Record a walk-in tenant on the host's listing.
  app.post("/host/listings/:id/walk-ins", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const body = createWalkInSchema.parse(request.body);
    const walkIn = await walkInService.create(id, user.id, body);
    return reply.status(201).send({ walkIn: toWalkIn(walkIn) });
  });

  // List walk-ins for the listing (current by default).
  app.get("/host/listings/:id/walk-ins", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const query = walkInQuerySchema.parse(request.query);
    const page = await walkInService.listForListing(id, query);
    return reply.send({ items: page.items.map(toWalkIn), nextCursor: page.nextCursor });
  });

  // Check out a walk-in — frees the bed. Ownership enforced in the service (404).
  app.post("/host/walk-ins/:walkInId/checkout", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { walkInId } = walkInParamSchema.parse(request.params);
    const walkIn = await walkInService.checkout(walkInId, user);
    return reply.send({ walkIn: toWalkIn(walkIn) });
  });
};
