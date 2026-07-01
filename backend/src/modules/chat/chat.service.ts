import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatReport, Conversation, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { objectStorage, type PresignedUpload } from "../../lib/storage.js";
import { chatTransport } from "../../lib/chat-transport.js";
import { stayService } from "../stay/stay.service.js";
import { containsPhoneNumber } from "./chat.logic.js";
import type { SendChatMessageInput } from "./chat.schema.js";

const EXT_FOR_MIME: Record<"image/jpeg" | "image/png", string> = { "image/jpeg": "jpg", "image/png": "png" };

/** Per-user private prefix; every chat photo lives under it so keys can't be forged. */
function chatPhotoPrefix(userId: string): string {
  return `chat/${userId}/`;
}

export interface Participant {
  id: string;
  role: UserRole;
}

export interface ConversationView {
  conversation: Conversation;
  hostName: string;
  chatEnabled: boolean;
}

export interface ChatMessageWithPhoto {
  message: ChatMessage;
  photoUrl: string | null;
}

/** A foreign/absent conversation is reported as 404 — existence is never leaked. */
const conversationNotFound = () =>
  new AppError({ statusCode: 404, code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" });
const chatDisabled = () =>
  new AppError({ statusCode: 409, code: "CHAT_DISABLED", message: "Chat is closed for this booking" });

/** Load a conversation only for one of its participants (tenant or host). */
async function loadForCaller(conversationId: string, callerId: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { booking: { select: { status: true } } },
  });
  if (!convo || (convo.tenantId !== callerId && convo.hostId !== callerId)) throw conversationNotFound();
  return convo;
}

/** Best-effort, post-commit publish to the real-time transport (Firestore + FCM). */
async function publish(convo: Conversation, message: ChatMessage): Promise<void> {
  const recipientId = message.senderId === convo.tenantId ? convo.hostId : convo.tenantId;
  const tokens = await prisma.deviceToken.findMany({ where: { userId: recipientId }, select: { token: true } });
  const photoUrl =
    message.kind === "PHOTO" && message.photoRef ? await objectStorage.presignDownload(message.photoRef) : null;
  await chatTransport.publishMessage(
    {
      conversationId: convo.id,
      messageId: message.id,
      senderId: message.senderId,
      senderRole: message.senderRole,
      kind: message.kind,
      body: message.body,
      photoUrl,
      createdAt: message.createdAt.toISOString(),
    },
    [{ userId: recipientId, fcmTokens: tokens.map((t) => t.token) }],
  );
}

export const chatService = {
  /** Presigned PUT URL for one chat photo. */
  async createPhotoUploadUrl(userId: string, contentType: "image/jpeg" | "image/png"): Promise<PresignedUpload> {
    const key = `${chatPhotoPrefix(userId)}${randomUUID()}.${EXT_FOR_MIME[contentType]}`;
    return objectStorage.presignUpload({ key, contentType });
  },

  /**
   * The conversation for the TENANT's current host — their active stay's booking
   * (created on first access). Null when there is no active stay. `chatEnabled`
   * is false once the booking is no longer CONFIRMED.
   */
  async currentForTenant(tenantId: string): Promise<ConversationView | null> {
    const stay = await stayService.getActiveStay(tenantId, new Date());
    if (!stay) return null;

    const booking = await prisma.booking.findUnique({
      where: { id: stay.id },
      select: {
        tenantId: true,
        listingId: true,
        status: true,
        listing: { select: { hostId: true, host: { select: { fullName: true } } } },
      },
    });
    if (!booking) return null;

    const conversation = await prisma.conversation.upsert({
      where: { bookingId: stay.id },
      create: { bookingId: stay.id, tenantId: booking.tenantId, hostId: booking.listing.hostId, listingId: booking.listingId },
      update: {},
    });
    return { conversation, hostName: booking.listing.host.fullName, chatEnabled: booking.status === "CONFIRMED" };
  },

  /**
   * Send a message. Enforces: caller is a participant (404 otherwise), the
   * booking is still CONFIRMED (else CHAT_DISABLED), and TEXT carries NO phone
   * number (else 422). EVERY message is mirrored to Postgres (audit) BEFORE the
   * best-effort transport publish — the client is never trusted (see /CLAUDE.md).
   */
  async sendMessage(conversationId: string, sender: Participant, input: SendChatMessageInput): Promise<ChatMessage> {
    const convo = await loadForCaller(conversationId, sender.id);
    if (convo.booking.status !== "CONFIRMED") throw chatDisabled();

    if (input.kind === "TEXT") {
      if (containsPhoneNumber(input.text ?? "")) {
        throw new AppError({
          statusCode: 422,
          code: "PHONE_NUMBER_NOT_ALLOWED",
          message: "For your safety, phone numbers can't be shared in chat",
        });
      }
    } else if (!input.photoRef?.startsWith(chatPhotoPrefix(sender.id))) {
      throw new AppError({ statusCode: 422, code: "INVALID_PHOTO_REF", message: "Photo must come from your own upload URL" });
    }

    const message = await prisma.chatMessage.create({
      data: {
        conversationId,
        senderId: sender.id,
        senderRole: sender.role,
        kind: input.kind,
        body: input.kind === "TEXT" ? (input.text ?? null) : null,
        photoRef: input.kind === "PHOTO" ? (input.photoRef ?? null) : null,
      },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    await publish(convo, message).catch((err) => logger.error({ err, messageId: message.id }, "chat transport publish failed"));
    return message;
  },

  /** A participant reads message history (audit / reconnect fallback), newest first. */
  async listMessages(
    conversationId: string,
    caller: Participant,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: ChatMessageWithPhoto[]; nextCursor: string | null }> {
    await loadForCaller(conversationId, caller.id);
    const rows = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    const items = await Promise.all(
      page.items.map(async (message) => ({
        message,
        photoUrl: message.kind === "PHOTO" && message.photoRef ? await objectStorage.presignDownload(message.photoRef) : null,
      })),
    );
    return { items, nextCursor: page.nextCursor };
  },

  /** Publish an ephemeral typing indicator (Firestore only; never persisted). */
  async setTyping(conversationId: string, caller: Participant, isTyping: boolean): Promise<void> {
    await loadForCaller(conversationId, caller.id);
    await chatTransport.publishTyping(conversationId, caller.id, isTyping).catch(() => undefined);
  },

  /** Report a message for admin moderation. Reporter must be a conversation participant. */
  async reportMessage(messageId: string, reporter: Participant, reason?: string): Promise<ChatReport> {
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { tenantId: true, hostId: true } } },
    });
    if (!message || (message.conversation.tenantId !== reporter.id && message.conversation.hostId !== reporter.id)) {
      throw new AppError({ statusCode: 404, code: "MESSAGE_NOT_FOUND", message: "Message not found" });
    }
    return prisma.chatReport.create({ data: { messageId, reporterId: reporter.id, reason: reason ?? null } });
  },

  /** ADMIN oversight: reported messages, newest first (read-only audit feed). */
  async listReportsForAdmin(query: { cursor?: string; limit: number }): Promise<Page<unknown>> {
    const rows = await prisma.chatReport.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        message: {
          select: { id: true, conversationId: true, senderId: true, senderRole: true, kind: true, body: true, createdAt: true },
        },
      },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        reporterId: r.reporterId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        message: {
          id: r.message.id,
          conversationId: r.message.conversationId,
          senderId: r.message.senderId,
          senderRole: r.message.senderRole,
          kind: r.message.kind,
          // Photo bodies are null; text is shown so an admin can triage.
          text: r.message.kind === "TEXT" ? r.message.body : null,
          createdAt: r.message.createdAt.toISOString(),
        },
      })),
      nextCursor: page.nextCursor,
    };
  },
};
