import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { broadcastService } from "./broadcast.service.js";
import { broadcastIdParamSchema, broadcastsQuerySchema, createBroadcastSchema } from "./broadcast.schema.js";

/**
 * Admin notifications & WhatsApp broadcast routes (PRD §7.12). ADMIN-only
 * (default-deny). Compose/schedule to a segment, review history with open-rate,
 * send now, or cancel a scheduled one. The weekly rate cap + audit live in the
 * service.
 */
export const broadcastRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("ADMIN"));

  // History (newest first), each with its open-rate.
  app.get("/admin/broadcasts", async (request) =>
    broadcastService.list(broadcastsQuerySchema.parse(request.query)),
  );

  // Compose + schedule (now or later). Enforces the platform-wide weekly cap.
  app.post("/admin/broadcasts", async (request, reply) => {
    const admin = getAuthUser(request);
    const body = createBroadcastSchema.parse(request.body);
    return reply.status(201).send({ broadcast: await broadcastService.create(admin, body, request.ip) });
  });

  // Send a scheduled broadcast now.
  app.post("/admin/broadcasts/:id/send", async (request) => {
    const admin = getAuthUser(request);
    const { id } = broadcastIdParamSchema.parse(request.params);
    return { broadcast: await broadcastService.sendNow(admin, id, request.ip) };
  });

  // Cancel a scheduled broadcast.
  app.post("/admin/broadcasts/:id/cancel", async (request) => {
    const admin = getAuthUser(request);
    const { id } = broadcastIdParamSchema.parse(request.params);
    return { broadcast: await broadcastService.cancel(admin, id, request.ip) };
  });
};
