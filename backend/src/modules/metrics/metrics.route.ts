import type { FastifyPluginAsync } from "fastify";
import { metricsService } from "./metrics.service.js";

/**
 * GET /v1/metrics — one cached snapshot powering the admin Dashboard. ADMIN-only
 * (default-deny). The grouped queries + 30s Redis cache live in the service so
 * the dashboard can refresh without hammering the DB.
 */
export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("ADMIN"));

  app.get("/metrics", async () => metricsService.getMetrics());
};
