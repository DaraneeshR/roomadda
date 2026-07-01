/**
 * Chat request schemas. Definitions live in `@roomadda/shared` (single source of
 * truth, see /CLAUDE.md); this module only re-exports them.
 */
export {
  sendChatMessageSchema,
  chatTypingSchema,
  reportChatMessageSchema,
  chatPhotoUrlSchema,
  listChatMessagesQuerySchema,
  uuidParamSchema as chatIdParamSchema,
} from "@roomadda/shared";

export type { SendChatMessageInput, ListChatMessagesQuery } from "@roomadda/shared";
