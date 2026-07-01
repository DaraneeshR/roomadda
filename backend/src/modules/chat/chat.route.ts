import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { chatService } from "./chat.service.js";
import { toChatMessage, toConversation } from "./chat.serializer.js";
import {
  chatIdParamSchema,
  chatPhotoUrlSchema,
  chatTypingSchema,
  listChatMessagesQuerySchema,
  reportChatMessageSchema,
  sendChatMessageSchema,
} from "./chat.schema.js";

export const chatRoutes: FastifyPluginAsync = async (app) => {
  // The conversation with the tenant's current host (their active stay). TENANT
  // only; null when there is no active stay.
  app.get(
    "/chat/current",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const view = await chatService.currentForTenant(user.id);
      return reply.send({
        conversation: view ? toConversation(view.conversation, view.hostName, view.chatEnabled) : null,
      });
    },
  );

  // Presigned PUT URL for one chat photo (participant — TENANT or HOST).
  app.post(
    "/chat/photo-url",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { contentType } = chatPhotoUrlSchema.parse(request.body);
      return reply.status(201).send(await chatService.createPhotoUploadUrl(user.id, contentType));
    },
  );

  // Read message history (audit / reconnect fallback), newest first.
  app.get(
    "/chat/:id/messages",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = chatIdParamSchema.parse(request.params);
      const query = listChatMessagesQuerySchema.parse(request.query);
      const { items, nextCursor } = await chatService.listMessages(id, user, query);
      return reply.send({
        items: items.map(({ message, photoUrl }) => toChatMessage(message, user.id, photoUrl)),
        nextCursor,
      });
    },
  );

  // Send a message (TEXT or PHOTO). Mirrored to Postgres, then delivered.
  app.post(
    "/chat/:id/messages",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = chatIdParamSchema.parse(request.params);
      const body = sendChatMessageSchema.parse(request.body);
      const message = await chatService.sendMessage(id, user, body);
      return reply.status(201).send({ message: toChatMessage(message, user.id, null) });
    },
  );

  // Typing indicator (ephemeral — published to the transport, never persisted).
  app.post(
    "/chat/:id/typing",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = chatIdParamSchema.parse(request.params);
      const { isTyping } = chatTypingSchema.parse(request.body);
      await chatService.setTyping(id, user, isTyping);
      return reply.status(204).send();
    },
  );

  // Long-press → report a message for admin moderation.
  app.post(
    "/chat/messages/:id/report",
    { preHandler: [app.authenticate, app.requireRole("TENANT", "HOST")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = chatIdParamSchema.parse(request.params);
      const { reason } = reportChatMessageSchema.parse(request.body ?? {});
      const report = await chatService.reportMessage(id, user, reason);
      return reply.status(201).send({ id: report.id });
    },
  );
};
