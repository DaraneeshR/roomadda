import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { stayService } from "./stay.service.js";
import { toActiveStay } from "./stay.serializer.js";

export const stayRoutes: FastifyPluginAsync = async (app) => {
  // The caller's current active stay — their CONFIRMED booking once move-in has
  // arrived (moveInDate <= today). Drives the mobile post-move-in dashboard,
  // which replaces the browse home automatically. Returns `{ activeStay: null }`
  // before move-in or when there is no stay. TENANT only; scoped to the caller,
  // so it never leaks another tenant's booking. The host emergency contact is
  // included here per PRD (dashboard only — never in chat); no KYC/payment data.
  app.get(
    "/me/active-stay",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const now = new Date();
      const stay = await stayService.getActiveStay(user.id, now);
      return reply.send({ activeStay: stay ? toActiveStay(stay, now) : null });
    },
  );
};
