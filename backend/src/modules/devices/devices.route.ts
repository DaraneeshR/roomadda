import type { FastifyPluginAsync } from "fastify";
import { registerDeviceSchema } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { getAuthUser } from "../../plugins/auth.js";

/**
 * FCM device-token registration for push (chat + future notifications). The
 * token is unique per device; re-registering re-points it at the current user
 * (e.g. a shared device). Any authenticated user may register their device.
 */
export const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/devices", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { token, platform } = registerDeviceSchema.parse(request.body);
    await prisma.deviceToken.upsert({
      where: { token },
      create: { userId: user.id, token, platform: platform ?? null },
      update: { userId: user.id, platform: platform ?? null },
    });
    return reply.status(204).send();
  });

  // De-register a device (e.g. on logout). Scoped to the caller's own token.
  app.delete("/devices", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { token } = registerDeviceSchema.pick({ token: true }).parse(request.body);
    await prisma.deviceToken.deleteMany({ where: { token, userId: user.id } });
    return reply.status(204).send();
  });
};
