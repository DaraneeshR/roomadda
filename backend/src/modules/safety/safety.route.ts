import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { safetyService } from "./safety.service.js";
import { toTrustedContact } from "./safety.serializer.js";
import { createTrustedContactSchema, sosSchema, trustedContactIdParamSchema } from "./safety.schema.js";

export const safetyRoutes: FastifyPluginAsync = async (app) => {
  // The caller's trusted contacts (+ the max so the client can cap "add").
  app.get(
    "/trusted-contacts",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const items = await safetyService.listContacts(user.id);
      return reply.send({ items: items.map(toTrustedContact), max: safetyService.maxContacts });
    },
  );

  // Add a trusted contact (max 3).
  app.post(
    "/trusted-contacts",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createTrustedContactSchema.parse(request.body);
      const contact = await safetyService.addContact(user.id, body);
      return reply.status(201).send({ contact: toTrustedContact(contact) });
    },
  );

  // Remove one of the caller's trusted contacts.
  app.delete(
    "/trusted-contacts/:id",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = trustedContactIdParamSchema.parse(request.params);
      await safetyService.removeContact(user.id, id);
      return reply.status(204).send();
    },
  );

  // Trigger SOS — SMSes every trusted contact with the caller's location AND
  // alerts admin. Coordinates are optional so it still fires without a GPS fix.
  app.post(
    "/sos",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = sosSchema.parse(request.body ?? {});
      const result = await safetyService.triggerSos(user.id, body);
      return reply.send(result);
    },
  );
};
