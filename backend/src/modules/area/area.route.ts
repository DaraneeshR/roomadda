import type { FastifyPluginAsync } from "fastify";
import { areaInsightsQuerySchema, areaParamSchema } from "./area.schema.js";
import { areaService } from "./area.service.js";

/**
 * GET /v1/areas/:area/insights — PUBLIC (discovery is open, /CLAUDE.md #5) price
 * insights for one area: bands + a rent histogram over PUBLISHED listings only.
 * The response carries aggregates alone (no PII, no masked fields), and the
 * service serves it from a Redis cache so SEO area pages and the filter histogram
 * do not hammer the DB.
 */
export const areaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/areas/:area/insights", async (request) => {
    const { area } = areaParamSchema.parse(request.params);
    const { city } = areaInsightsQuerySchema.parse(request.query);
    return areaService.getInsights(area, city ?? null);
  });
};
