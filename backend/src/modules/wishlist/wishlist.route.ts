import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { toPublicListing } from "../listing/serializer.js";
import { wishlistService } from "./wishlist.service.js";
import { wishlistParamSchema, wishlistQuerySchema } from "./wishlist.schema.js";

/**
 * Per-user wishlist — TENANT only, always the caller's own list. Listings are
 * returned through the MASKED public serializer (a saved listing is not a
 * confirmed booking, so alias/area only — see /CLAUDE.md domain rule #4).
 */
export const wishlistRoutes: FastifyPluginAsync = async (app) => {
  // The caller's saved listings (masked, cursor-paginated).
  app.get(
    "/wishlist",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request) => {
      const user = getAuthUser(request);
      const query = wishlistQuerySchema.parse(request.query);
      const page = await wishlistService.list(user.id, query);
      return { items: page.items.map(toPublicListing), nextCursor: page.nextCursor };
    },
  );

  // Save a listing (idempotent).
  app.post(
    "/wishlist/:listingId",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { listingId } = wishlistParamSchema.parse(request.params);
      await wishlistService.add(user.id, listingId);
      return reply.status(201).send({ listingId, saved: true });
    },
  );

  // Remove a saved listing (idempotent).
  app.delete(
    "/wishlist/:listingId",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { listingId } = wishlistParamSchema.parse(request.params);
      await wishlistService.remove(user.id, listingId);
      return reply.status(204).send();
    },
  );
};
