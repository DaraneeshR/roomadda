import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../../lib/errors.js";
import { socialService } from "./social.service.js";
import { listingIdParamSchema, viewingHeartbeatSchema } from "./social.schema.js";

/**
 * Social-proof routes. Both are PUBLIC (browsing is open — /CLAUDE.md rule #5):
 *  - GET  /listings/:id/social            — the honesty-gated widget object.
 *  - POST /listings/:id/social/heartbeat  — "viewing now" presence ping.
 * Every number the GET returns is REAL and floor-gated in the service; the
 * client cannot fabricate an omitted field.
 */
export const socialRoutes: FastifyPluginAsync = async (app) => {
  // The honesty-gated widget object for a listing.
  app.get("/listings/:id/social", async (request) => {
    const { id } = listingIdParamSchema.parse(request.params);
    const social = await socialService.getSocialProof(id);
    return { social };
  });

  // Presence heartbeat. optionalAuthenticate so a signed-in viewer is deduped by
  // their user id across tabs/devices; an anonymous viewer is deduped by the
  // client-supplied session id. Fire-and-forget (204).
  app.post(
    "/listings/:id/social/heartbeat",
    { preHandler: [app.optionalAuthenticate] },
    async (request, reply) => {
      const { id } = listingIdParamSchema.parse(request.params);
      const { sessionId } = viewingHeartbeatSchema.parse(request.body ?? {});

      // A signed-in viewer counts once by user id; an anonymous viewer MUST bring
      // a stable session id or we cannot count them distinctly (never guess).
      const sessionKey = request.user
        ? `u:${request.user.id}`
        : sessionId
          ? `s:${sessionId}`
          : null;
      if (!sessionKey) {
        throw badRequest("sessionId is required for anonymous viewers");
      }

      await socialService.heartbeat(id, sessionKey);
      return reply.status(204).send();
    },
  );
};
