import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import type { LivenessResponse, ReadinessResponse } from "./health.schema.js";

/**
 * Liveness + readiness endpoints (unversioned, for orchestrators).
 *  - /health        cheap "am I up" check, never touches dependencies.
 *  - /health/ready   verifies Postgres, the PostGIS extension, and Redis.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (): Promise<LivenessResponse> => {
    return { status: "ok", uptimeSeconds: Math.floor(process.uptime()) };
  });

  app.get("/health/ready", async (_request, reply) => {
    const checks: ReadinessResponse["checks"] = {
      database: "down",
      postgis: "down",
      redis: "down",
    };

    try {
      // Parameterless tagged template — confirms the connection AND reads the
      // installed PostGIS version in one cheap round-trip.
      const rows = await prisma.$queryRaw<Array<{ version: string | null }>>`
        SELECT extversion AS version FROM pg_extension WHERE extname = 'postgis'
      `;
      checks.database = "ok";
      checks.postgis = rows[0]?.version ?? "missing";
    } catch (err) {
      reply.log.error({ err }, "readiness: database/postgis check failed");
    }

    try {
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "unexpected";
    } catch (err) {
      reply.log.error({ err }, "readiness: redis check failed");
    }

    const ready =
      checks.database === "ok" &&
      checks.postgis !== "down" &&
      checks.postgis !== "missing" &&
      checks.redis === "ok";

    const body: ReadinessResponse = {
      status: ready ? "ready" : "not_ready",
      checks,
    };
    return reply.status(ready ? 200 : 503).send(body);
  });
};
