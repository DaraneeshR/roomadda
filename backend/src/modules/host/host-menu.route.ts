import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { hostMenuService } from "./host-menu.service.js";
import { requireOwnedListing } from "./ownership.js";
import { toMealMenuDay } from "../menu/menu.serializer.js";
import {
  listingIdParamSchema,
  listingTemplateParamSchema,
  upsertMealMenuSchema,
  createMealTemplateSchema,
  applyMealTemplateSchema,
} from "./host.schema.js";

/**
 * Host meal-menu write surface (the read side lives in the menu module). All
 * HOST/ADMIN, ownership-scoped. Single-day writes are limited to today/tomorrow;
 * weekly templates plan further ahead.
 */
export const hostMenuRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  // Write one day's menu (today or tomorrow) — pushes a silent update to tenants.
  app.put("/host/listings/:id/menu", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const body = upsertMealMenuSchema.parse(request.body);
    const menu = await hostMenuService.writeDay(id, user.id, body);
    return reply.send({ day: toMealMenuDay(menu) });
  });

  // List saved weekly templates.
  app.get("/host/listings/:id/menu-templates", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    return reply.send({ items: await hostMenuService.listTemplates(id) });
  });

  // Save (create/replace) a weekly template.
  app.post("/host/listings/:id/menu-templates", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const body = createMealTemplateSchema.parse(request.body);
    const template = await hostMenuService.saveTemplate(id, body);
    return reply.status(201).send({ template });
  });

  // Delete a template.
  app.delete("/host/listings/:id/menu-templates/:templateId", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id, templateId } = listingTemplateParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    await hostMenuService.deleteTemplate(id, templateId);
    return reply.status(204).send();
  });

  // Apply a template to a week (fills 7 days Mon→Sun from weekStartDate).
  app.post("/host/listings/:id/menu-templates/apply", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    await requireOwnedListing(id, user);
    const body = applyMealTemplateSchema.parse(request.body);
    const daysFilled = await hostMenuService.applyTemplate(id, user.id, body);
    return reply.send({ daysFilled });
  });
};
