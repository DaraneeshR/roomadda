import type { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { settleBookingTx, type SettlementResult } from "./settlement.js";

interface Actor {
  id: string;
  role: UserRole;
}

const notFound = (): AppError =>
  new AppError({ statusCode: 404, code: "CASH_COLLECTION_NOT_FOUND", message: "Cash collection not found" });

export const cashService = {
  /** AGENT (owner) or ADMIN marks a cash collection COLLECTED, then settles. */
  async markCollected(actor: Actor, cashCollectionId: string, ip?: string): Promise<SettlementResult> {
    const cc = await prisma.cashCollection.findUnique({ where: { id: cashCollectionId } });
    if (!cc) throw notFound();
    if (actor.role !== "ADMIN" && cc.agentId !== actor.id) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "Not your cash collection" });
    }
    if (cc.status !== "PENDING") {
      throw new AppError({ statusCode: 409, code: "INVALID_STATE", message: "Only PENDING collections can be collected" });
    }

    const settlement = await prisma.$transaction(async (tx) => {
      await tx.cashCollection.update({
        where: { id: cashCollectionId },
        data: { status: "COLLECTED", collectedAt: new Date() },
      });
      return settleBookingTx(tx, cc.bookingId);
    });

    await writeAudit({
      actorId: actor.id,
      action: "cash.collected",
      targetId: cc.bookingId,
      ip,
      metadata: { cashCollectionId, confirmed: settlement.confirmed },
    });
    return settlement;
  },

  /** ADMIN marks a collected cash entry RECONCILED, then re-settles. */
  async markReconciled(actor: Actor, cashCollectionId: string, ip?: string): Promise<SettlementResult> {
    const cc = await prisma.cashCollection.findUnique({ where: { id: cashCollectionId } });
    if (!cc) throw notFound();
    if (cc.status !== "COLLECTED") {
      throw new AppError({ statusCode: 409, code: "INVALID_STATE", message: "Only COLLECTED collections can be reconciled" });
    }

    const settlement = await prisma.$transaction(async (tx) => {
      await tx.cashCollection.update({
        where: { id: cashCollectionId },
        data: { status: "RECONCILED", reconciledAt: new Date() },
      });
      return settleBookingTx(tx, cc.bookingId);
    });

    await writeAudit({
      actorId: actor.id,
      action: "cash.reconciled",
      targetId: cc.bookingId,
      ip,
      metadata: { cashCollectionId },
    });
    return settlement;
  },
};
