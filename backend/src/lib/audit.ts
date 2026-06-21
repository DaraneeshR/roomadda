import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append an immutable audit record. Best-effort: an audit failure is logged but
 * never breaks the request that triggered it.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        metadata: entry.metadata,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}
