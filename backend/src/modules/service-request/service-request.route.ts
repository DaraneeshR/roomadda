import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { serviceRequestService } from "./service-request.service.js";
import { toServiceRequest, toServiceRequestDetail } from "./service-request.serializer.js";
import {
  createServiceRequestSchema,
  listServiceRequestsQuerySchema,
  serviceRequestCommentInputSchema,
  serviceRequestIdParamSchema,
  serviceRequestPhotoUrlSchema,
  serviceRequestRatingSchema,
} from "./service-request.schema.js";

export const serviceRequestRoutes: FastifyPluginAsync = async (app) => {
  // Presigned PUT URL for one photo (TENANT). Static path declared before :id.
  app.post(
    "/service-requests/photo-url",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { contentType } = serviceRequestPhotoUrlSchema.parse(request.body);
      return reply.status(201).send(await serviceRequestService.createPhotoUploadUrl(user.id, contentType));
    },
  );

  // Raise a ticket — TENANT, requires an active stay (the server resolves which).
  app.post(
    "/service-requests",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createServiceRequestSchema.parse(request.body);
      const req = await serviceRequestService.create(user.id, body);
      return reply.status(201).send({ request: toServiceRequestDetail(req) });
    },
  );

  // List the caller's own tickets, newest first, cursor-paginated.
  app.get(
    "/service-requests",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const query = listServiceRequestsQuerySchema.parse(request.query);
      const page = await serviceRequestService.listForTenant(user.id, query);
      return reply.send({ items: page.items.map(toServiceRequest), nextCursor: page.nextCursor });
    },
  );

  // Read one of the caller's own tickets (status + comment thread). 404 if foreign.
  app.get(
    "/service-requests/:id",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = serviceRequestIdParamSchema.parse(request.params);
      const req = await serviceRequestService.getDetailForTenant(id, user.id);
      return reply.send({ request: toServiceRequestDetail(req) });
    },
  );

  // Follow-up comment on the caller's own ticket. There is NO delete route — a
  // tenant can never delete a request (or a comment).
  app.post(
    "/service-requests/:id/comments",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = serviceRequestIdParamSchema.parse(request.params);
      const { body } = serviceRequestCommentInputSchema.parse(request.body);
      const req = await serviceRequestService.addComment(id, user, body);
      return reply.status(201).send({ request: toServiceRequestDetail(req) });
    },
  );

  // 1–5 satisfaction rating — accepted only once the ticket is RESOLVED.
  app.post(
    "/service-requests/:id/rating",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = serviceRequestIdParamSchema.parse(request.params);
      const { rating } = serviceRequestRatingSchema.parse(request.body);
      const req = await serviceRequestService.rate(id, user.id, rating);
      return reply.send({ request: toServiceRequestDetail(req) });
    },
  );
};
