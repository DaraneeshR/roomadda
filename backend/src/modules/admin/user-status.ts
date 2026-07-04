import { type User, type UserRole, UserStatus } from "@prisma/client";
import type { ModerateUserInput } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * ADMIN account-standing moderation, shared by the host and agent surfaces.
 * SUSPEND/BAN require a reason and revoke the target's live sessions so the block
 * bites immediately (auth login + refresh also reject non-ACTIVE users);
 * REINSTATE clears it. Every transition is audited. A target whose role is not
 * the expected one is a 404 (existence is not leaked across surfaces).
 */

type Actor = { id: string };

const STATUS_FOR: Record<ModerateUserInput["action"], UserStatus> = {
  SUSPEND: UserStatus.SUSPENDED,
  BAN: UserStatus.BANNED,
  REINSTATE: UserStatus.ACTIVE,
};

const ACTION_AUDIT: Record<ModerateUserInput["action"], string> = {
  SUSPEND: "user.suspended",
  BAN: "user.banned",
  REINSTATE: "user.reinstated",
};

export async function moderateUser(
  actor: Actor,
  targetId: string,
  expectedRole: UserRole,
  input: ModerateUserInput,
  ip?: string,
): Promise<User> {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.role !== expectedRole) {
    throw new AppError({ statusCode: 404, code: "USER_NOT_FOUND", message: "User not found" });
  }

  const nextStatus = STATUS_FOR[input.action];
  const reason = input.action === "REINSTATE" ? null : (input.reason ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: targetId },
      data: { status: nextStatus, statusReason: reason, statusUpdatedAt: new Date() },
    });
    // Blocking a user must drop their live sessions; reinstating leaves them be.
    if (nextStatus !== UserStatus.ACTIVE) {
      await tx.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return user;
  });

  await writeAudit({
    actorId: actor.id,
    action: ACTION_AUDIT[input.action],
    targetId,
    ip,
    metadata: { role: expectedRole, before: target.status, after: nextStatus, reason },
  });
  return updated;
}
