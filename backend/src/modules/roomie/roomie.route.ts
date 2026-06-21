import type { FastifyPluginAsync } from "fastify";
import { roomieRequestSchema } from "./roomie.schema.js";
import { roomieService } from "./roomie.service.js";

/**
 * Roomie — the public marketing assistant. This route is INTENTIONALLY public
 * (no auth): browsing/discovery is open per /CLAUDE.md (just-in-time KYC). It is
 * an untrusted, LLM-backed surface, so the hardening lives in the service:
 * strict zod validation at the boundary, Redis-backed per-IP + global rate
 * limits, masked-only retrieval, a prompt-injection-guarded prompt, and output
 * sanitization. No PII is stored beyond an ephemeral, short-TTL session.
 */
export const roomieRoutes: FastifyPluginAsync = async (app) => {
  app.post("/roomie", async (request, reply) => {
    const body = roomieRequestSchema.parse(request.body);
    const result = await roomieService.ask({
      message: body.message,
      sessionId: body.sessionId,
      ip: request.ip,
    });
    return reply.send(result);
  });
};
