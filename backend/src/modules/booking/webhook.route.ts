import type { FastifyPluginAsync } from "fastify";
import { webhookService } from "./webhook.service.js";

/**
 * Razorpay webhook. Registered as its own encapsulated plugin so the raw-body
 * parser below is scoped ONLY to this route — every other route keeps the
 * default JSON parser. The signature must be verified over the exact raw bytes.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.post("/webhooks/razorpay", async (request, reply) => {
    const raw = request.body as Buffer;
    const signature = request.headers["x-razorpay-signature"];
    const eventId = request.headers["x-razorpay-event-id"];
    const result = await webhookService.processRazorpay(
      raw,
      typeof signature === "string" ? signature : undefined,
      typeof eventId === "string" ? eventId : undefined,
    );
    // Always 200 on accepted/duplicate so Razorpay stops retrying.
    return reply.status(200).send({ status: result.status });
  });
};
