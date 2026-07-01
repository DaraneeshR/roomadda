import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { hostServiceService, toHostServiceRequest } from "./host-service.service.js";
import { listingIdParamSchema, hostServiceQuerySchema, serviceNoteSchema } from "./host.schema.js";

/**
 * Host service queue. HOST/ADMIN, scoped to the caller's own listings. The host can
 * acknowledge / note / resolve but has NO delete route (hosts can never delete a
 * request). Each mutation re-checks ownership (404 on a foreign request).
 */
export const hostServiceRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  // The host's service queue (escalated first) + rollup stats.
  app.get("/host/service-requests", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const query = hostServiceQuerySchema.parse(request.query);
    const { items, nextCursor, stats } = await hostServiceService.listQueue(user, query);
    return reply.send({ items: items.map(toHostServiceRequest), nextCursor, stats });
  });

  // Read one request (with its comment thread).
  app.get("/host/service-requests/:id", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const req = await hostServiceService.getDetail(id, user);
    return reply.send({ request: toHostServiceRequest(req) });
  });

  // Acknowledge a submitted request.
  app.post("/host/service-requests/:id/acknowledge", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const req = await hostServiceService.acknowledge(id, user);
    return reply.send({ request: toHostServiceRequest(req) });
  });

  // Add a tenant-visible note.
  app.post("/host/service-requests/:id/notes", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const { note } = serviceNoteSchema.parse(request.body);
    const req = await hostServiceService.addNote(id, { id: user.id, role: user.role as "HOST" | "ADMIN" }, note);
    return reply.status(201).send({ request: toHostServiceRequest(req) });
  });

  // Mark resolved.
  app.post("/host/service-requests/:id/resolve", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const req = await hostServiceService.resolve(id, user);
    return reply.send({ request: toHostServiceRequest(req) });
  });
};
