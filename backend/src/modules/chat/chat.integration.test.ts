import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Booking, PgListing, Room, User } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { chatTransport } from "../../lib/chat-transport.js";
import { chatRoutes } from "./chat.route.js";
import { chatService } from "./chat.service.js";

/**
 * Tenant <-> host chat against a live DB. The audit MIRROR (Postgres) is the
 * server's source of truth: every message is written here before best-effort
 * real-time delivery. Proven: messages mirror to Postgres, a cancelled booking
 * blocks chat, and there is NO phone-number leakage path. The transport is
 * spied (Firebase isn't wired in tests).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("tenant <-> host chat (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User;
  let outsider: User; // a tenant who is NOT a participant
  let listing: PgListing;
  let room: Room;
  let booking: Booking;
  let conversationId: string;
  let tenantToken: string;
  let hostToken: string;
  let outsiderToken: string;
  const listingIds: string[] = [];

  const send = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(chatRoutes, { prefix: "/v1" });
    await app.ready();

    // Don't actually hit Firebase; assert the publish path is invoked.
    vi.spyOn(chatTransport, "publishMessage").mockResolvedValue();
    vi.spyOn(chatTransport, "publishTyping").mockResolvedValue();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Chat Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Chat Tenant", role: "TENANT", isPhoneVerified: true } });
    outsider = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Outsider", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Chat PG", areaLabel: "Area", city: "City",
        actualName: "Chat Real Name", fullAddress: "1 Chat Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    listingIds.push(listing.id);
    room = await prisma.room.create({ data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 } });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 6)}`, status: "BOOKED" } });
    booking = await prisma.booking.create({
      data: {
        bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "CONFIRMED",
        tokenAmountPaise: 500_000, monthlyRentPaise: 1_000_000, depositPaise: 500_000,
        moveInDate: new Date(Date.now() - DAY_MS), confirmedAt: new Date(),
      },
    });

    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
    outsiderToken = await signAccessToken({ sub: outsider.id, role: "TENANT" });

    // Establish the conversation via the active stay (the "current host" scope).
    const view = await chatService.currentForTenant(tenant.id);
    conversationId = view!.conversation.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.chatReport.deleteMany({ where: { message: { conversationId } } });
    await prisma.chatMessage.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, outsider.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /chat/current scopes to the host and exposes NO phone number", async () => {
    const res = await send("GET", "/v1/chat/current", tenantToken);
    expect(res.statusCode).toBe(200);
    const convo = res.json().conversation;
    expect(convo.id).toBe(conversationId);
    expect(convo.chatEnabled).toBe(true);
    expect(convo.host.name).toBe("Chat Host");
    expect(typeof convo.repliesWithin).toBe("string");
    // The conversation/host payload carries a name ONLY — never a phone number.
    expect(Object.keys(convo.host)).toEqual(["name"]);
  });

  it("a sent message is MIRRORED to Postgres and published to the transport", async () => {
    const res = await send("POST", `/v1/chat/${conversationId}/messages`, tenantToken, { text: "Hi, is the geyser working?" });
    expect(res.statusCode).toBe(201);
    const message = res.json().message;
    expect(message.kind).toBe("TEXT");
    expect(message.text).toBe("Hi, is the geyser working?");
    expect(message.mine).toBe(true);

    // The durable audit mirror exists in Postgres.
    const row = await prisma.chatMessage.findUnique({ where: { id: message.id } });
    expect(row?.body).toBe("Hi, is the geyser working?");
    expect(row?.conversationId).toBe(conversationId);
    expect(row?.senderId).toBe(tenant.id);

    // Real-time delivery was attempted.
    expect(chatTransport.publishMessage).toHaveBeenCalled();
  });

  it("the host can reply (tenant <-> host), also mirrored", async () => {
    const res = await send("POST", `/v1/chat/${conversationId}/messages`, hostToken, { text: "Yes, it was fixed this morning." });
    expect(res.statusCode).toBe(201);
    expect(res.json().message.senderRole).toBe("HOST");
    const count = await prisma.chatMessage.count({ where: { conversationId, senderId: host.id } });
    expect(count).toBe(1);
  });

  it("REJECTS a message containing a phone number (no leakage path) and does NOT mirror it", async () => {
    const before = await prisma.chatMessage.count({ where: { conversationId } });
    const res = await send("POST", `/v1/chat/${conversationId}/messages`, tenantToken, { text: "call me on 9876543210 please" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PHONE_NUMBER_NOT_ALLOWED");
    const after = await prisma.chatMessage.count({ where: { conversationId } });
    expect(after).toBe(before); // nothing was written
  });

  it("history is participant-scoped — an outsider gets 404", async () => {
    const ok = await send("GET", `/v1/chat/${conversationId}/messages?limit=50`, tenantToken);
    expect(ok.statusCode).toBe(200);
    expect((ok.json().items as unknown[]).length).toBeGreaterThanOrEqual(2);

    const foreign = await send("GET", `/v1/chat/${conversationId}/messages`, outsiderToken);
    expect(foreign.statusCode).toBe(404);
  });

  it("long-press report creates a moderation record", async () => {
    const list = await send("GET", `/v1/chat/${conversationId}/messages?limit=1`, tenantToken);
    const messageId = list.json().items[0].id as string;
    const res = await send("POST", `/v1/chat/messages/${messageId}/report`, tenantToken, { reason: "spam" });
    expect(res.statusCode).toBe(201);
    const report = await prisma.chatReport.findFirst({ where: { messageId } });
    expect(report?.reason).toBe("spam");
  });

  it("chat is DISABLED once the booking is cancelled", async () => {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const res = await send("POST", `/v1/chat/${conversationId}/messages`, tenantToken, { text: "still there?" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CHAT_DISABLED");
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/chat/current" });
    expect(res.statusCode).toBe(401);
  });
});
