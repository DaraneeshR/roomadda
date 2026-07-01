import type { ChatMessage, Conversation } from "@prisma/client";
import type { ChatMessage as ChatMessageDTO, Conversation as ConversationDTO } from "@roomadda/shared";

/** Static reassurance copy ("typically replies within X"); refine later from data. */
export const REPLIES_WITHIN = "Usually replies within a few hours";

/**
 * Photos are private objects surfaced as a short-lived `photoUrl` (presigned by
 * the caller); the raw key never leaves the server. `mine` aligns the bubble for
 * the caller. Text is null for a photo and vice-versa.
 */
export function toChatMessage(m: ChatMessage, callerId: string, photoUrl: string | null): ChatMessageDTO {
  return {
    id: m.id,
    kind: m.kind,
    text: m.kind === "TEXT" ? m.body : null,
    photoUrl: m.kind === "PHOTO" ? photoUrl : null,
    senderRole: m.senderRole,
    mine: m.senderId === callerId,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toConversation(convo: Conversation, hostName: string, chatEnabled: boolean): ConversationDTO {
  return {
    id: convo.id,
    bookingId: convo.bookingId,
    chatEnabled,
    // Name only — a phone number is NEVER exposed through chat (see /CLAUDE.md).
    host: { name: hostName },
    repliesWithin: REPLIES_WITHIN,
  };
}
