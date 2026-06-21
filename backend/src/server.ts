import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { buildApp } from "./app.js";
import { startBookingExpiry, stopBookingExpiry } from "./jobs/booking-expiry.js";

async function main(): Promise<void> {
  const app = await buildApp();

  // Verify the database connection before we accept traffic.
  await prisma.$connect();

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, "roomadda-api listening");

  // Background worker: sweep expired booking holds.
  await startBookingExpiry();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "graceful shutdown started");
    try {
      await app.close(); // stop accepting connections, drain in-flight requests
      await stopBookingExpiry();
      await prisma.$disconnect();
      await redis.quit();
      logger.info("graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

// Process-level safety nets: log and exit non-zero so the orchestrator restarts
// the process into a known-good state (see /CLAUDE.md reliability rules).
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "unhandledRejection — exiting");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException — exiting");
  process.exit(1);
});

main().catch((err: unknown) => {
  logger.fatal({ err }, "failed to start server");
  process.exit(1);
});
