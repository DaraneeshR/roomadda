import { configDefaults, defineConfig } from "vitest/config";

/**
 * Backend tests run as fast unit tests with no live infra. We provide a valid
 * env here so `src/config/env.ts` passes validation when modules are imported.
 * (Values are dummies; tests that touch a real DB/Redis are not part of this
 * suite.)
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a live DB; they run via vitest.integration.config.ts.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    env: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "3001",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://test:test@localhost:5432/roomadda_test?schema=public",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: "test_access_secret_minimum_thirty_two_chars_xxx",
      JWT_REFRESH_SECRET: "test_refresh_secret_minimum_thirty_two_chars_xx",
      RAZORPAY_KEY_ID: "rzp_test_dummy",
      RAZORPAY_KEY_SECRET: "dummy",
      RAZORPAY_WEBHOOK_SECRET: "dummy",
      MSG91_AUTH_KEY: "dummy",
      CORS_ORIGINS: "http://localhost:3000",
    },
  },
});
