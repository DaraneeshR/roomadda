import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env, isProduction } from "../config/env.js";
import { redis } from "../lib/redis.js";

/**
 * Baseline security plugins: helmet headers, a CORS allowlist (credentials
 * enabled), and a Redis-backed rate limiter (default 100 req/min/IP). The 1 MB
 * body limit and request-id generation are set on the Fastify instance in
 * src/app.ts; here we echo the request id back on every response.
 */
export const securityPlugin = fp(
  async function security(app) {
    await app.register(helmet, {
      // CSP is for browser documents; an API gains little and it can break tools
      // in dev. Enable in production where the surface is fixed.
      contentSecurityPolicy: isProduction,
    });

    await app.register(cors, {
      origin: (origin, cb) => {
        // No Origin header = non-browser client (mobile, server-to-server) -> allow.
        // Browser requests must match the configured allowlist.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          cb(null, true);
          return;
        }
        cb(new Error("Origin not allowed by CORS"), false);
      },
      credentials: true,
    });

    await app.register(rateLimit, {
      max: env.RATE_LIMIT_MAX,
      timeWindow: env.RATE_LIMIT_WINDOW,
      redis,
      nameSpace: "roomadda-rl:",
      keyGenerator: (request) => request.ip,
    });

    // Surface the request id so clients can quote it when reporting issues.
    app.addHook("onRequest", async (request, reply) => {
      reply.header("x-request-id", request.id);
    });
  },
  { name: "security" },
);
