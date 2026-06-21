import { PrismaClient } from "@prisma/client";
import { env, isDevelopment } from "../config/env.js";

/**
 * Prisma client singleton. Reused across tsx hot-reloads in dev so we don't
 * exhaust the connection pool. Query logging is dev-only (not test/prod).
 */
const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    log: isDevelopment ? ["query", "warn", "error"] : ["warn", "error"],
  });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
