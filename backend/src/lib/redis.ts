import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * ioredis singleton, shared by the rate limiter and app code. Reused across
 * hot-reloads in dev to avoid leaking connections.
 */
const createRedis = (): Redis =>
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? createRedis();

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
