import type { AdminBroadcast, BroadcastAudience } from "@prisma/client";
import { BROADCAST_WEEKLY_CAP, type AdminBroadcastDTO, type BroadcastsQuery, type CreateBroadcastInput } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { toPage, type Page } from "../../lib/pagination.js";

/**
 * Admin notifications & WhatsApp broadcast (PRD §7.12). Compose a push/WhatsApp
 * message to a user segment, schedule it now or later, and review history with
 * open-rate. A platform-wide rate cap (<= BROADCAST_WEEKLY_CAP per rolling week)
 * is enforced so users are never spammed. Actual delivery is a stub seam (logged)
 * — the send fan-out plugs in once a push/WhatsApp channel is wired. Every state
 * change is audited (see /CLAUDE.md).
 */

type Actor = { id: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toDTO(b: AdminBroadcast): AdminBroadcastDTO {
  return {
    id: b.id,
    channel: b.channel,
    audience: b.audience,
    audienceValue: b.audienceValue,
    title: b.title,
    body: b.body,
    deepLink: b.deepLink,
    status: b.status,
    scheduledAt: b.scheduledAt.toISOString(),
    sentAt: b.sentAt?.toISOString() ?? null,
    recipientCount: b.recipientCount,
    openCount: b.openCount,
    openRate: b.recipientCount > 0 ? Math.round((b.openCount / b.recipientCount) * 1000) / 1000 : null,
    createdAt: b.createdAt.toISOString(),
  };
}

/** Best-effort delivery seam. Real push/WhatsApp fan-out plugs in here. */
function deliver(b: AdminBroadcast): void {
  logger.info(
    { broadcastId: b.id, channel: b.channel, audience: b.audience, recipients: b.recipientCount },
    "broadcast delivery (stub)",
  );
}

/** Snapshot recipient estimate for a segment (labelled an estimate in the UI). */
async function resolveRecipientCount(audience: BroadcastAudience, value: string | null): Promise<number> {
  switch (audience) {
    case "ALL_USERS":
      return prisma.user.count();
    case "TENANTS":
      return prisma.user.count({ where: { role: "TENANT" } });
    case "HOSTS":
      return prisma.user.count({ where: { role: "HOST" } });
    case "AGENTS":
      return prisma.user.count({ where: { role: "AGENT" } });
    case "CITY": {
      if (!value) return 0;
      // Hosts owning a listing in the city + agents scoped to it (estimate).
      const [hosts, agents] = await Promise.all([
        prisma.pgListing.findMany({ where: { city: { equals: value, mode: "insensitive" } }, select: { hostId: true }, distinct: ["hostId"] }),
        prisma.user.count({ where: { role: "AGENT", assignedCity: { equals: value, mode: "insensitive" } } }),
      ]);
      return hosts.length + agents;
    }
    case "BEHAVIOUR": {
      // Known behaviour: wishlisted-but-never-booked. Unknown keys -> 0.
      if (value === "wishlisted_no_booking") {
        const [wishlisted, booked] = await Promise.all([
          prisma.wishlist.findMany({ select: { userId: true }, distinct: ["userId"] }),
          prisma.booking.findMany({ where: { status: "CONFIRMED" }, select: { tenantId: true }, distinct: ["tenantId"] }),
        ]);
        const bookedIds = new Set(booked.map((b) => b.tenantId));
        return wishlisted.filter((w) => !bookedIds.has(w.userId)).length;
      }
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Enforce the platform-wide cap: at most BROADCAST_WEEKLY_CAP non-cancelled
 * broadcasts may be scheduled within the 7 days ending at `scheduledAt`.
 */
async function assertWithinRateCap(scheduledAt: Date): Promise<void> {
  const windowStart = new Date(scheduledAt.getTime() - WEEK_MS);
  const recent = await prisma.adminBroadcast.count({
    where: {
      status: { not: "CANCELLED" },
      scheduledAt: { gt: windowStart, lte: scheduledAt },
    },
  });
  if (recent >= BROADCAST_WEEKLY_CAP) {
    throw new AppError({
      statusCode: 429,
      code: "BROADCAST_RATE_LIMITED",
      message: `At most ${BROADCAST_WEEKLY_CAP} broadcasts are allowed per rolling week`,
    });
  }
}

export const broadcastService = {
  /**
   * Compose a broadcast. Enforces the weekly cap, resolves a recipient estimate,
   * and either sends now (scheduledAt <= now) or leaves it SCHEDULED for later.
   */
  async create(actor: Actor, input: CreateBroadcastInput, ip?: string): Promise<AdminBroadcastDTO> {
    const now = new Date();
    const scheduledAt = input.scheduledAt ?? now;
    await assertWithinRateCap(scheduledAt);

    const recipientCount = await resolveRecipientCount(input.audience, input.audienceValue ?? null);
    const sendNow = scheduledAt.getTime() <= now.getTime();

    const created = await prisma.adminBroadcast.create({
      data: {
        channel: input.channel,
        audience: input.audience,
        audienceValue: input.audienceValue ?? null,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink ?? null,
        scheduledAt,
        recipientCount,
        status: sendNow ? "SENT" : "SCHEDULED",
        sentAt: sendNow ? now : null,
        createdById: actor.id,
      },
    });
    await writeAudit({
      actorId: actor.id,
      action: "broadcast.created",
      targetId: created.id,
      ip,
      metadata: { channel: created.channel, audience: created.audience, recipientCount, sendNow },
    });
    if (sendNow) {
      deliver(created);
      await writeAudit({ actorId: actor.id, action: "broadcast.sent", targetId: created.id, ip, metadata: { recipientCount } });
    }
    return toDTO(created);
  },

  /** Broadcast history (newest first), each with its open-rate. */
  async list(query: BroadcastsQuery): Promise<Page<AdminBroadcastDTO>> {
    const rows = await prisma.adminBroadcast.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toDTO), nextCursor: page.nextCursor };
  },

  /** Manually send a SCHEDULED broadcast now (also the scheduler's entrypoint). */
  async sendNow(actor: Actor, id: string, ip?: string): Promise<AdminBroadcastDTO> {
    const b = await prisma.adminBroadcast.findUnique({ where: { id } });
    if (!b) throw new AppError({ statusCode: 404, code: "BROADCAST_NOT_FOUND", message: "Broadcast not found" });
    if (b.status !== "SCHEDULED") {
      throw new AppError({ statusCode: 409, code: "INVALID_TRANSITION", message: "Only a scheduled broadcast can be sent" });
    }
    const sent = await prisma.adminBroadcast.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
    deliver(sent);
    await writeAudit({ actorId: actor.id, action: "broadcast.sent", targetId: id, ip, metadata: { recipientCount: sent.recipientCount } });
    return toDTO(sent);
  },

  /** Cancel a SCHEDULED broadcast (a sent one cannot be recalled). */
  async cancel(actor: Actor, id: string, ip?: string): Promise<AdminBroadcastDTO> {
    const b = await prisma.adminBroadcast.findUnique({ where: { id } });
    if (!b) throw new AppError({ statusCode: 404, code: "BROADCAST_NOT_FOUND", message: "Broadcast not found" });
    if (b.status !== "SCHEDULED") {
      throw new AppError({ statusCode: 409, code: "INVALID_TRANSITION", message: "Only a scheduled broadcast can be cancelled" });
    }
    const cancelled = await prisma.adminBroadcast.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit({ actorId: actor.id, action: "broadcast.cancelled", targetId: id, ip });
    return toDTO(cancelled);
  },
};
