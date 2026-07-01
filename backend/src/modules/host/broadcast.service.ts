import type { BroadcastResponse } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { writeAudit } from "../../lib/audit.js";
import { chatTransport } from "../../lib/chat-transport.js";

/**
 * Host broadcast: one message fanned out to a property's CURRENT tenants. Each
 * delivery is mirrored into that tenant's booking chat thread (a HOST message),
 * so the broadcast is auditable and shows up in chat. Capped at 3 per rolling 24h
 * per property. Ex-tenants are NEVER recipients (only CONFIRMED bookings).
 */

export const BROADCAST_DAILY_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Delivery {
  conversationId: string;
  messageId: string;
  tenantId: string;
  body: string;
  senderId: string;
  createdAt: Date;
}

export const broadcastService = {
  /**
   * Send a broadcast. Enforces the 3/24h cap, writes a HOST chat message into each
   * current tenant's conversation, and records the broadcast. Returns the recipient
   * count + remaining daily quota. Real-time delivery (Firestore/FCM) is best-effort
   * post-commit — the durable chat mirror is the source of truth (/CLAUDE.md).
   */
  async send(listingId: string, hostId: string, body: string): Promise<BroadcastResponse> {
    const since = new Date(Date.now() - WINDOW_MS);

    // Current tenants = CONFIRMED bookings on this listing. Ex-tenants excluded.
    const bookings = await prisma.booking.findMany({
      where: { listingId, status: "CONFIRMED" },
      select: { id: true, tenantId: true },
    });

    const { broadcast, deliveries } = await prisma.$transaction(async (tx) => {
      const sentToday = await tx.broadcast.count({ where: { listingId, createdAt: { gte: since } } });
      if (sentToday >= BROADCAST_DAILY_LIMIT) {
        throw new AppError({
          statusCode: 429,
          code: "BROADCAST_LIMIT_REACHED",
          message: `A property can send at most ${BROADCAST_DAILY_LIMIT} broadcasts per day`,
        });
      }

      // Mirror into each current tenant's chat thread (a HOST message).
      const deliveries: Delivery[] = [];
      for (const booking of bookings) {
        const convo = await tx.conversation.upsert({
          where: { bookingId: booking.id },
          create: { bookingId: booking.id, tenantId: booking.tenantId, hostId, listingId },
          update: { updatedAt: new Date() },
        });
        const message = await tx.chatMessage.create({
          data: { conversationId: convo.id, senderId: hostId, senderRole: "HOST", kind: "TEXT", body },
        });
        deliveries.push({
          conversationId: convo.id,
          messageId: message.id,
          tenantId: booking.tenantId,
          body,
          senderId: hostId,
          createdAt: message.createdAt,
        });
      }

      const broadcast = await tx.broadcast.create({
        data: { listingId, hostId, body, recipientCount: deliveries.length },
      });
      return { broadcast, deliveries };
    });

    await writeAudit({
      actorId: hostId,
      action: "host.broadcast.sent",
      targetId: listingId,
      metadata: { recipientCount: deliveries.length },
    });

    // Best-effort real-time fan-out (never blocks/fails the broadcast).
    void deliverRealtime(deliveries).catch((err) =>
      logger.error({ err, broadcastId: broadcast.id }, "broadcast realtime delivery failed"),
    );

    const sentNow = await prisma.broadcast.count({ where: { listingId, createdAt: { gte: since } } });
    return {
      id: broadcast.id,
      body: broadcast.body,
      recipientCount: deliveries.length,
      remainingToday: Math.max(0, BROADCAST_DAILY_LIMIT - sentNow),
      createdAt: broadcast.createdAt.toISOString(),
    };
  },
};

/** Push exactly the messages this broadcast created to recipients (Firestore + FCM). */
async function deliverRealtime(deliveries: Delivery[]): Promise<void> {
  await Promise.allSettled(
    deliveries.map(async (d) => {
      const tokens = await prisma.deviceToken.findMany({ where: { userId: d.tenantId }, select: { token: true } });
      await chatTransport.publishMessage(
        {
          conversationId: d.conversationId,
          messageId: d.messageId,
          senderId: d.senderId,
          senderRole: "HOST",
          kind: "TEXT",
          body: d.body,
          photoUrl: null,
          createdAt: d.createdAt.toISOString(),
        },
        [{ userId: d.tenantId, fcmTokens: tokens.map((t) => t.token) }],
      );
    }),
  );
}
