import type { FastifyPluginAsync } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getAuthUser } from "../../plugins/auth.js";
import { authService } from "../auth/auth.service.js";
import { roleChangeBodySchema, userIdParamSchema } from "../auth/auth.schema.js";
import { updateProfileSchema } from "./users.schema.js";
import { serializeUserSelf } from "./users.serializer.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  // The caller's own profile.
  app.get("/me", { preHandler: [app.authenticate] }, async (request) => {
    const auth = getAuthUser(request);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new AppError({ statusCode: 401, code: "UNAUTHENTICATED", message: "User not found" });
    }
    return { user: serializeUserSelf(user) };
  });

  // Update the caller's OWN profile. Self-scoped by construction — it writes to
  // request.user.id and takes no :id, so a user can never edit another's row.
  // Identity fields (phone, email, role) are NOT editable here.
  app.patch("/me", { preHandler: [app.authenticate] }, async (request) => {
    const auth = getAuthUser(request);
    const body = updateProfileSchema.parse(request.body);
    const updated = await prisma.user.update({ where: { id: auth.id }, data: body });
    return { user: serializeUserSelf(updated) };
  });

  // Admin-only: change a user's role. Default-deny via requireRole(ADMIN).
  app.patch(
    "/users/:id/role",
    { preHandler: [app.authenticate, app.requireRole(UserRole.ADMIN)] },
    async (request) => {
      const actor = getAuthUser(request);
      const { id } = userIdParamSchema.parse(request.params);
      const { role } = roleChangeBodySchema.parse(request.body);
      const updated = await authService.changeRole({
        actorId: actor.id,
        targetUserId: id,
        newRole: role,
        ip: request.ip,
      });
      return { user: serializeUserSelf(updated) };
    },
  );
};
