import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { socialService } from "../social/social.service.js";
import { listingService } from "./listing.service.js";
import {
  canManageListing,
  canViewPrivateListing,
  toPrivateListing,
  toPublicListing,
  type Viewer,
} from "./serializer.js";
import { isVisibleTo } from "./visibility.js";
import {
  createBedSchema,
  createListingSchema,
  createPhotoSchema,
  createRoomSchema,
  listFiltersSchema,
  listingIdParamSchema,
  listingPhotoUploadUrlSchema,
  nearbyQuerySchema,
  roomParamSchema,
  updateListingSchema,
} from "./listing.schema.js";

/** Load a listing for management and enforce ownership (default-deny). */
async function requireManageable(id: string, user: Viewer): Promise<void> {
  const ownership = await listingService.getOwnership(id);
  if (!ownership) {
    throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
  }
  if (!canManageListing(ownership, user)) {
    throw new AppError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "You do not have permission to manage this listing",
    });
  }
}

/**
 * Ownership gate that reports a non-owner as 404 (never 403) so a host cannot
 * probe another host's inventory by id — matching the host surface's privacy
 * stance (see modules/host/ownership.ts + /CLAUDE.md masking rule #4). Used by
 * the photo-upload presign, which hands back a writable URL.
 */
async function requireOwnedListing(id: string, user: Viewer): Promise<void> {
  const ownership = await listingService.getOwnership(id);
  if (!ownership || !canManageListing(ownership, user)) {
    throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
  }
}

export const listingRoutes: FastifyPluginAsync = async (app) => {
  // ===== HOST (own listings only) =========================================
  app.post(
    "/listings",
    { preHandler: [app.authenticate, app.requireRole("HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createListingSchema.parse(request.body);
      const listing = await listingService.createListing(user.id, body);
      return reply.status(201).send({ listing: toPrivateListing(listing) });
    },
  );

  app.patch(
    "/listings/:id",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      await requireManageable(id, user);
      const body = updateListingSchema.parse(request.body);
      const listing = await listingService.updateListing(id, body);
      return reply.send({ listing: toPrivateListing(listing) });
    },
  );

  app.post(
    "/listings/:id/rooms",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      await requireManageable(id, user);
      const body = createRoomSchema.parse(request.body);
      const room = await listingService.addRoom(id, body);
      return reply.status(201).send({
        room: {
          id: room.id,
          listingId: room.listingId,
          name: room.name,
          floor: room.floor,
          sharingType: room.sharingType,
          monthlyRentPaise: room.monthlyRentPaise,
          depositPaise: room.depositPaise,
        },
      });
    },
  );

  app.post(
    "/listings/:id/rooms/:roomId/beds",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id, roomId } = roomParamSchema.parse(request.params);
      await requireManageable(id, user);
      const body = createBedSchema.parse(request.body);
      const bed = await listingService.addBed(id, roomId, body);
      return reply.status(201).send({
        bed: {
          id: bed.id,
          roomId: bed.roomId,
          label: bed.label,
          status: bed.status,
          monthlyRentPaise: bed.monthlyRentPaise,
        },
      });
    },
  );

  // Presigned PUT for one on-device photo (public bucket). A non-owner is 404 —
  // existence is never leaked since this hands back a writable URL.
  app.post(
    "/listings/:id/photos/upload-url",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      await requireOwnedListing(id, user);
      const { contentType } = listingPhotoUploadUrlSchema.parse(request.body);
      return reply.status(201).send(await listingService.createPhotoUploadUrl(id, contentType));
    },
  );

  app.post(
    "/listings/:id/photos",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      await requireManageable(id, user);
      const body = createPhotoSchema.parse(request.body);
      const photo = await listingService.addPhoto(id, body);
      return reply.status(201).send({
        photo: { id: photo.id, url: photo.url, isPrimary: photo.isPrimary, sortOrder: photo.sortOrder },
      });
    },
  );

  // ===== PUBLIC / TENANT (masked by default) ==============================

  // Browse — always the masked public shape, PUBLISHED only, cursor-paginated.
  app.get("/listings", async (request) => {
    const filters = listFiltersSchema.parse(request.query);
    const page = await listingService.listPublished(filters);
    return { items: page.items.map(toPublicListing), nextCursor: page.nextCursor };
  });

  // Nearby search — masked public shape; index-backed (ST_DWithin on geography).
  app.get("/listings/search/nearby", async (request) => {
    const query = nearbyQuerySchema.parse(request.query);
    const { items, nextCursor } = await listingService.nearby(query);
    return {
      items: items.map(({ listing, distanceM }) => ({
        ...toPublicListing(listing),
        // Bucketed to ~100 m so repeated queries cannot triangulate exact geo.
        distanceMeters: Math.round(distanceM / 100) * 100,
      })),
      nextCursor,
    };
  });

  // Detail — private shape ONLY for owner / ADMIN / AGENT / confirmed tenant.
  app.get(
    "/listings/:id",
    { preHandler: [app.optionalAuthenticate] },
    async (request, reply) => {
      const { id } = listingIdParamSchema.parse(request.params);
      const listing = await listingService.getById(id);
      if (!listing) {
        throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
      }

      const user = request.user ?? null;
      const hasConfirmedBooking =
        user?.role === "TENANT" ? await listingService.hasConfirmedBooking(id, user.id) : false;
      const reveal = canViewPrivateListing(listing, { user, hasConfirmedBooking });

      // Hide non-published (or host-paused) listings from anyone who can't see
      // the private shape.
      if ((listing.status !== "PUBLISHED" || listing.paused) && !reveal) {
        throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
      }

      // Visibility enforcement: a CORPORATE_ONLY listing must NEVER surface on the
      // B2C detail read. Owner / admin / agent (and a confirmed tenant) keep access
      // via `reveal`; everyone else gets a 404 exactly like a hidden listing.
      if (!isVisibleTo("B2C", listing.visibility) && !reveal) {
        throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
      }

      // Fold in the honesty-gated social proof (see modules/social). It never
      // gates the core response: any failure (e.g. Redis blip) degrades to an
      // empty object, exactly like every unmet floor — the client shows nothing.
      let social = {};
      try {
        social = await socialService.getSocialProof(id);
      } catch (err) {
        logger.warn({ err, listingId: id }, "social proof unavailable for listing detail");
      }

      return reply.send({
        listing: reveal ? toPrivateListing(listing) : toPublicListing(listing),
        social,
      });
    },
  );
};
