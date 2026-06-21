import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { cashService } from "./cash.service.js";
import { cashCollectionParamSchema } from "./booking.schema.js";

export const cashRoutes: FastifyPluginAsync = async (app) => {
  // AGENT (owner) or ADMIN marks cash collected -> re-settles the booking.
  app.patch(
    "/cash-collections/:id/collect",
    { preHandler: [app.authenticate, app.requireRole("AGENT", "ADMIN")] },
    async (request) => {
      const user = getAuthUser(request);
      const { id } = cashCollectionParamSchema.parse(request.params);
      const settlement = await cashService.markCollected(user, id, request.ip);
      return { status: "COLLECTED", confirmed: settlement.confirmed };
    },
  );

  // ADMIN reconciles a collected entry -> re-settles.
  app.patch(
    "/cash-collections/:id/reconcile",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (request) => {
      const user = getAuthUser(request);
      const { id } = cashCollectionParamSchema.parse(request.params);
      const settlement = await cashService.markReconciled(user, id, request.ip);
      return { status: "RECONCILED", confirmed: settlement.confirmed };
    },
  );
};
