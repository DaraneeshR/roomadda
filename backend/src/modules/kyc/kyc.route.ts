import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { kycService } from "./kyc.service.js";
import { kycSubmitSchema, kycUploadUrlSchema } from "./kyc.schema.js";

/**
 * Self-serve KYC intake — closes the just-in-time KYC loop (browsing is open;
 * payment is gated server-side until VERIFIED, see /CLAUDE.md). Documents go to
 * a private, encrypted bucket via presigned URLs; only object keys reach the DB.
 */
export const kycRoutes: FastifyPluginAsync = async (app) => {
  // Presigned PUT URL for one document slot — TENANT only.
  app.post(
    "/kyc/upload-url",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = kycUploadUrlSchema.parse(request.body);
      return reply.status(201).send(await kycService.createUploadUrl(user.id, body));
    },
  );

  // Submit the uploaded documents for review — TENANT only. Stores PENDING.
  app.post(
    "/kyc",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = kycSubmitSchema.parse(request.body);
      return reply.status(201).send(await kycService.submit(user.id, body));
    },
  );

  // The caller's own KYC status (+ rejection reason). Drives the booking gate.
  app.get("/kyc/me", { preHandler: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    return { kyc: await kycService.getMine(user.id) };
  });
};
