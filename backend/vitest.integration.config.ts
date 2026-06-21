import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a REAL Postgres (the booking concurrency,
 * webhook idempotency, and split-settlement guarantees can only be proven
 * against a live DB). Locally this defaults to the dev DB on 5435; CI sets
 * INTEGRATION_DATABASE_URL to its Postgres service.
 */
const databaseUrl =
  process.env.INTEGRATION_DATABASE_URL ??
  "postgresql://roomadda:change_me_in_local_env@localhost:5435/roomadda?schema=public";
const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "redis://localhost:6379";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Shared DB — run files sequentially to avoid cross-test interference.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "3001",
      LOG_LEVEL: "silent",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      JWT_ACCESS_SECRET: "test_access_secret_minimum_thirty_two_chars_xxx",
      JWT_REFRESH_SECRET: "test_refresh_secret_minimum_thirty_two_chars_xx",
      RAZORPAY_KEY_ID: "rzp_test_dummy",
      RAZORPAY_KEY_SECRET: "dummy",
      RAZORPAY_WEBHOOK_SECRET: "whsec_integration_dummy",
      MSG91_AUTH_KEY: "dummy",
      CORS_ORIGINS: "http://localhost:3000",
    },
  },
});
