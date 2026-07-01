import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { AppError } from "../../lib/errors.js";
import { listingService } from "../listing/listing.service.js";
import { canManageListing } from "../listing/serializer.js";
import { mealMenuService } from "./menu.service.js";
import { emptyMenuDay, toMealMenuDay } from "./menu.serializer.js";
import { listingIdParamSchema, menuQuerySchema, upsertMealMenuSchema } from "./menu.schema.js";

export const mealMenuRoutes: FastifyPluginAsync = async (app) => {
  // Tenant meal-menu view: today + tomorrow for a listing. The menu carries no
  // masked data (just dish text), so any authenticated tenant/host/admin may read
  // it; the mobile only surfaces it for a stay whose PG offers meals.
  app.get(
    "/listings/:id/menu",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST", "ADMIN")] },
    async (request, reply) => {
      const { id } = listingIdParamSchema.parse(request.params);
      const { date } = menuQuerySchema.parse(request.query);
      const { dates, rows } = await mealMenuService.getTwoDayMenu(id, date ?? new Date());
      const byDate = new Map(rows.map((r) => [r.date.getTime(), r]));
      const days = dates.map((d) => {
        const row = byDate.get(d.getTime());
        return row ? toMealMenuDay(row) : emptyMenuDay(d);
      });
      return reply.send({ days });
    },
  );

  // Minimal host upsert (own listing only) so menus can be created/seeded; the
  // full host-update UI lands in the host phase. Default-deny + ownership check.
  app.post(
    "/listings/:id/menu",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = listingIdParamSchema.parse(request.params);
      const ownership = await listingService.getOwnership(id);
      if (!ownership) {
        throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
      }
      if (!canManageListing(ownership, user)) {
        throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "You do not have permission to manage this listing" });
      }
      const body = upsertMealMenuSchema.parse(request.body);
      const menu = await mealMenuService.upsertMenu(id, user.id, body);
      return reply.status(201).send({ day: toMealMenuDay(menu) });
    },
  );
};
