import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { hostListingService } from "./host-listing.service.js";
import { requireOwnedListing } from "./ownership.js";
import { toHostListing, toEditLogItem } from "./host-listing.serializer.js";
import {
  listingIdParamSchema,
  roomParamSchema,
  pageQuerySchema,
  updateHostListingSchema,
  updateHostRoomSchema,
  adjustInventorySchema,
} from "./host.schema.js";

/**
 * Host listing lifecycle + inventory. Every route is HOST/ADMIN (default-deny)
 * and ownership-scoped via requireOwnedListing — a host can only ever touch their
 * own listing (a foreign id is 404). The §9.2 go-live gate is reused on the
 * publish path.
 */
export const hostListingRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  // List the host's own listings (ADMIN sees all).
  app.get("/host/listings", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const query = pageQuerySchema.parse(request.query);
    const page = await hostListingService.listForHost(user, query);
    return reply.send({ items: page.items.map((l) => toHostListing(l)), nextCursor: page.nextCursor });
  });

  // Full host view of one listing (unmasked + per-room inventory).
  app.get("/host/listings/:id", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const listing = await hostListingService.getRow(id);
    return reply.send({ listing: toHostListing(listing) });
  });

  // Edit listing fields — minor edits go live; an address change re-queues.
  app.patch("/host/listings/:id", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const patch = updateHostListingSchema.parse(request.body);
    const { listing, classification } = await hostListingService.updateListing(id, user.id, patch);
    return reply.send({
      listing: toHostListing(listing),
      requeued: classification.requeue,
      changedFields: classification.changedFields,
    });
  });

  // Edit a room — a rent change > 20% re-queues the parent listing.
  app.patch("/host/listings/:id/rooms/:roomId", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id, roomId } = roomParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const patch = updateHostRoomSchema.parse(request.body);
    const { listing, classification } = await hostListingService.updateRoom(id, roomId, user.id, patch);
    return reply.send({
      listing: toHostListing(listing),
      requeued: classification.requeue,
      changedFields: classification.changedFields,
    });
  });

  // Publish — reuses the §9.2 go-live gate (422 LISTING_NOT_PUBLISHABLE if unmet).
  app.post("/host/listings/:id/publish", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const listing = await hostListingService.publish(id, user.id);
    return reply.send({ listing: toHostListing(listing) });
  });

  // Pause / unpause — hide from tenant discovery without deleting.
  app.post("/host/listings/:id/pause", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const listing = await hostListingService.setPaused(id, user.id, true);
    return reply.send({ listing: toHostListing(listing) });
  });

  app.post("/host/listings/:id/unpause", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const listing = await hostListingService.setPaused(id, user.id, false);
    return reply.send({ listing: toHostListing(listing) });
  });

  // Edit history (newest first).
  app.get("/host/listings/:id/edit-history", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const query = pageQuerySchema.parse(request.query);
    const page = await hostListingService.editHistory(id, query);
    return reply.send({ items: page.items.map(toEditLogItem), nextCursor: page.nextCursor });
  });

  // Mark a room's inventory verified now (clears the not-verified flag).
  app.post("/host/listings/:id/rooms/:roomId/verify-inventory", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id, roomId } = roomParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const listing = await hostListingService.verifyInventory(id, roomId);
    return reply.send({ listing: toHostListing(listing) });
  });

  // Manual walk-in inventory adjust (BLOCK / UNBLOCK beds — flagged distinctly).
  app.post("/host/listings/:id/rooms/:roomId/adjust-inventory", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id, roomId } = roomParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const { action, count } = adjustInventorySchema.parse(request.body);
    const listing = await hostListingService.adjustInventory(id, roomId, action, count);
    return reply.send({ listing: toHostListing(listing) });
  });
};
