import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { adService } from "./ad.service.js";
import {
  adIdParamSchema,
  createAdSchema,
  featuredQuerySchema,
  pendingAdsQuerySchema,
  putPricingSchema,
  rejectAdSchema,
  slotTypeParamSchema,
} from "./ad.schema.js";

export const adRoutes: FastifyPluginAsync = async (app) => {
  // ADMIN: set/update pricing for a slot type.
  app.put(
    "/ad-pricing/:slotType",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (request) => {
      const admin = getAuthUser(request);
      const { slotType } = slotTypeParamSchema.parse(request.params);
      const body = putPricingSchema.parse(request.body);
      const pricing = await adService.putPricing(admin, slotType, body, request.ip);
      return { pricing: { slotType: pricing.slotType, pricePaise: pricing.pricePaise, isActive: pricing.isActive } };
    },
  );

  // HOST: buy an ad slot (returns a Razorpay order). Approval is separate.
  app.post(
    "/ads",
    { preHandler: [app.authenticate, app.requireRole("HOST")] },
    async (request, reply) => {
      const host = getAuthUser(request);
      const body = createAdSchema.parse(request.body);
      const result = await adService.createAd(host, body);
      return reply.status(201).send(result);
    },
  );

  // ADMIN: paginated queue of paid ads awaiting approval.
  app.get(
    "/ads/pending",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (request) => {
      const query = pendingAdsQuerySchema.parse(request.query);
      return adService.listPending(query);
    },
  );

  app.post(
    "/ads/:id/approve",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (request) => {
      const admin = getAuthUser(request);
      const { id } = adIdParamSchema.parse(request.params);
      const ad = await adService.approve(admin, id, request.ip);
      return { ad: { id: ad.id, status: ad.status, approvedAt: ad.approvedAt?.toISOString() ?? null } };
    },
  );

  app.post(
    "/ads/:id/reject",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (request) => {
      const admin = getAuthUser(request);
      const { id } = adIdParamSchema.parse(request.params);
      const { reason } = rejectAdSchema.parse(request.body);
      const ad = await adService.reject(admin, id, reason, request.ip);
      return { ad: { id: ad.id, status: ad.status } };
    },
  );

  // PUBLIC: featured listings for front pages (masked, cached 60s).
  app.get("/featured", async (request) => {
    const { limit } = featuredQuerySchema.parse(request.query);
    return { items: await adService.featured(limit) };
  });
};
