import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { leaveNoticeService } from "./leave-notice.service.js";
import { toLeaveNotice } from "./leave-notice.serializer.js";
import { createLeaveNoticeSchema, leaveNoticeIdParamSchema } from "./leave-notice.schema.js";

export const leaveNoticeRoutes: FastifyPluginAsync = async (app) => {
  // Serve notice to vacate — TENANT, requires an active stay. The notice-period
  // rule is enforced server-side; the bed is flagged Vacating Soon on success.
  app.post(
    "/leave-notices",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { moveOutDate } = createLeaveNoticeSchema.parse(request.body);
      const notice = await leaveNoticeService.submit(user.id, moveOutDate);
      return reply.status(201).send({ notice: toLeaveNotice(notice, new Date()) });
    },
  );

  // The caller's own notices + the policy the form needs (period + earliest date).
  app.get(
    "/leave-notices",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const now = new Date();
      const items = await leaveNoticeService.listForTenant(user.id);
      return reply.send({
        items: items.map((n) => toLeaveNotice(n, now)),
        noticePeriodDays: leaveNoticeService.noticePeriodDays,
        earliestMoveOutDate: leaveNoticeService.earliestMoveOutDate(now).toISOString(),
      });
    },
  );

  // Withdraw an active notice — blocked within 3 days of move-out (409).
  app.post(
    "/leave-notices/:id/withdraw",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = leaveNoticeIdParamSchema.parse(request.params);
      const notice = await leaveNoticeService.withdraw(user.id, id);
      return reply.send({ notice: toLeaveNotice(notice, new Date()) });
    },
  );
};
