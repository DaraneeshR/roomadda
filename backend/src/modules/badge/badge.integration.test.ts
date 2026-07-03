import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { badgeAdminRoutes } from "./badge.route.js";
import { listingRoutes } from "../listing/listing.route.js";
import { badgeService } from "./badge.service.js";
import { DURABLE_BADGE_KINDS, TRENDING_BADGE_KINDS } from "./badge.rules.js";

/**
 * Trust-badge engine, end-to-end against a live Postgres. Proves badges are
 * EARNED only when the real rules hold, LOST when they stop (response-rate drop,
 * momentum fade), that Trending is time-boxed + swept, that an admin can suspend
 * a rule badge and grant FEATURED but can NEVER fake-grant a rule badge, and that
 * the listing serializer exposes the badges (priority-ordered) + the filter.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("trust-badge engine (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let agent: User;
  let admin: User;
  let tenant: User;
  let adminToken: string;
  let L: PgListing; // the RA-Assured subject
  let room: Room;
  const listingIds: string[] = [];
  const userIds: string[] = [];

  const now = new Date();

  const makeListing = async (alias: string, amenities: string[], instantBook = false): Promise<PgListing> => {
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias, areaLabel: "Indiranagar", city: "Bengaluru", amenities, instantBook,
        actualName: `${alias} Real`, fullAddress: "1 Badge Road", pincode: "560038",
        latitude: 12.97, longitude: 77.64, status: "PUBLISHED",
      },
    });
    listingIds.push(l.id);
    return l;
  };

  const addPhotos = (listingId: string, n: number) =>
    prisma.listingPhoto.createMany({
      data: Array.from({ length: n }, (_, i) => ({ listingId, url: `https://cdn/x/${randomUUID()}.jpg`, sortOrder: i })),
    });

  const approveInspection = async (listingId: string, amenities: Record<string, string>): Promise<void> => {
    const visit = await prisma.agentVisit.create({
      data: { listingId, agentId: agent.id, scheduledAt: now, status: "COMPLETED" },
    });
    await prisma.propertyInspection.create({
      data: { visitId: visit.id, agentId: agent.id, listingId, status: "APPROVED", amenities, reviewedAt: now },
    });
  };

  const makeBed = async (status: "AVAILABLE" | "BOOKED" = "BOOKED"): Promise<string> =>
    (await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status } })).id;

  /** A confirmed booking on L (for conversations / trending). */
  const makeBooking = async (listingId: string, confirmedAt: Date | null): Promise<string> => {
    const bedId = await makeBed("BOOKED");
    const b = await prisma.booking.create({
      data: {
        listingId, bedId, tenantId: tenant.id, status: "CONFIRMED",
        tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
        ...(confirmedAt ? { confirmedAt } : {}),
      },
    });
    return b.id;
  };

  /** An unanswered tenant inquiry thread on a booking -> drags response rate down. */
  const makeUnansweredConversation = async (listingId: string): Promise<void> => {
    const bookingId = await makeBooking(listingId, null);
    const convo = await prisma.conversation.create({
      data: { bookingId, tenantId: tenant.id, hostId: host.id, listingId },
    });
    await prisma.chatMessage.create({
      data: { conversationId: convo.id, senderId: tenant.id, senderRole: "TENANT", kind: "TEXT", body: "Hi?" },
    });
  };

  const activeBadgeKinds = async (listingId: string): Promise<string[]> => {
    const res = await app.inject({ method: "GET", url: `/v1/listings/${listingId}` });
    return (res.json().listing.badges as Array<{ kind: string }>).map((b) => b.kind);
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(badgeAdminRoutes, { prefix: "/v1" });
    await app.register(listingRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant", role: "TENANT", isPhoneVerified: true } });
    userIds.push(host.id, agent.id, admin.id, tenant.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });

    // Host KYC verified (needed for RA_VERIFIED).
    await prisma.kycRecord.create({ data: { userId: host.id, status: "VERIFIED", docType: "AADHAAR", verifiedAt: now } });

    // L qualifies for RA_VERIFIED and is ONE photo short of RA_ASSURED.
    L = await makeListing("Assured PG", ["wifi", "food"]);
    room = await prisma.room.create({ data: { listingId: L.id, name: "R1", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 } });
    await addPhotos(L.id, 7);
    await approveInspection(L.id, { wifi: "YES", food: "YES" });
  });

  afterAll(async () => {
    await prisma.trustTag.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.chatMessage.deleteMany({ where: { conversation: { listingId: { in: listingIds } } } });
    await prisma.conversation.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.propertyInspection.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.agentVisit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listingPhoto.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------- earn / lose
  it("earns RA-Assured ONLY when every condition holds (7 photos: Verified but not Assured)", async () => {
    await badgeService.reevaluateListing(L.id, DURABLE_BADGE_KINDS, { now });
    const kinds = await activeBadgeKinds(L.id);
    expect(kinds).toContain("RA_VERIFIED");
    expect(kinds).not.toContain("RA_ASSURED");
  });

  it("earns RA-Assured once the final condition (8th photo) is met", async () => {
    await addPhotos(L.id, 1); // now 8 photos
    await badgeService.reevaluateListing(L.id, DURABLE_BADGE_KINDS, { now });
    expect(await activeBadgeKinds(L.id)).toEqual(expect.arrayContaining(["RA_VERIFIED", "RA_ASSURED"]));
  });

  it("LOSES RA-Assured when the host response rate drops below 90%", async () => {
    // Two unanswered tenant inquiries -> response rate 0/2 = 0% < 90%.
    await makeUnansweredConversation(L.id);
    await makeUnansweredConversation(L.id);
    await badgeService.reevaluateListing(L.id, DURABLE_BADGE_KINDS, { now });
    const kinds = await activeBadgeKinds(L.id);
    expect(kinds).toContain("RA_VERIFIED"); // still verified
    expect(kinds).not.toContain("RA_ASSURED"); // lost
  });

  // ---------------------------------------------------------- trending
  it("earns time-boxed Trending on booked ≥3 this week, and loses it when momentum fades", async () => {
    const T = await makeListing("Trending PG", ["wifi"]);
    // 3 confirmed bookings this week.
    const bookingIds: string[] = [];
    for (let i = 0; i < 3; i++) bookingIds.push(await makeBooking(T.id, new Date(now.getTime() - DAY_MS)));

    await badgeService.reevaluateListing(T.id, TRENDING_BADGE_KINDS, { now });
    const tag = await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: T.id, kind: "TRENDING" } } });
    expect(tag).not.toBeNull();
    expect(tag!.expiresAt).not.toBeNull(); // time-boxed
    expect(await activeBadgeKinds(T.id)).toContain("TRENDING");

    // Momentum fades: drop the bookings, re-evaluate -> Trending removed.
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await badgeService.reevaluateListing(T.id, TRENDING_BADGE_KINDS, { now });
    expect(await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: T.id, kind: "TRENDING" } } })).toBeNull();
  });

  it("hides + sweeps an expired Trending badge (serializer never shows it)", async () => {
    const E = await makeListing("Expired PG", ["wifi"]);
    await prisma.trustTag.create({
      data: { listingId: E.id, kind: "TRENDING", source: "RULE", earnedAt: new Date(now.getTime() - 8 * DAY_MS), expiresAt: new Date(now.getTime() - DAY_MS) },
    });
    // Serializer treats an expired link as inactive.
    expect(await activeBadgeKinds(E.id)).not.toContain("TRENDING");
    // The sweep hard-deletes it.
    const swept = await badgeService.sweepExpired(now);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: E.id, kind: "TRENDING" } } })).toBeNull();
  });

  // ---------------------------------------------------------- admin
  it("admin CANNOT fake-grant a rule badge (403), but CAN grant paid FEATURED", async () => {
    const fake = await app.inject({
      method: "POST", url: `/v1/admin/listings/${L.id}/badges`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { kind: "RA_ASSURED", durationDays: 30 },
    });
    expect(fake.statusCode).toBe(403);
    expect(fake.json().error.code).toBe("BADGE_NOT_GRANTABLE");

    const granted = await app.inject({
      method: "POST", url: `/v1/admin/listings/${L.id}/badges`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { kind: "FEATURED", durationDays: 30 },
    });
    expect(granted.statusCode).toBe(201);

    // Featured is styled separately: it flags `featured`, not the badges list.
    const res = await app.inject({ method: "GET", url: `/v1/listings/${L.id}` });
    expect(res.json().listing.featured).toBe(true);
    expect((res.json().listing.badges as Array<{ kind: string }>).some((b) => b.kind === "FEATURED")).toBe(false);
  });

  it("admin can SUSPEND a rule badge (logged), and the engine will not re-earn it", async () => {
    // L currently holds RA_VERIFIED. Suspend it with a reason.
    const suspend = await app.inject({
      method: "POST", url: `/v1/admin/listings/${L.id}/badges/RA_VERIFIED/suspend`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { reason: "under manual review" },
    });
    expect(suspend.statusCode).toBe(200);
    expect(await activeBadgeKinds(L.id)).not.toContain("RA_VERIFIED"); // hidden

    // The reason is persisted for audit.
    const row = await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: L.id, kind: "RA_VERIFIED" } } });
    expect(row?.suspended).toBe(true);
    expect(row?.suspendedReason).toBe("under manual review");

    // Re-running the engine does NOT resurrect a suspended badge.
    await badgeService.reevaluateListing(L.id, DURABLE_BADGE_KINDS, { now });
    const after = await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: L.id, kind: "RA_VERIFIED" } } });
    expect(after?.suspended).toBe(true);
    expect(await activeBadgeKinds(L.id)).not.toContain("RA_VERIFIED");
  });

  it("rejects a non-admin caller on the badge admin routes", async () => {
    const hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
    const res = await app.inject({
      method: "POST", url: `/v1/admin/listings/${L.id}/badges`,
      headers: { authorization: `Bearer ${hostToken}` }, payload: { kind: "FEATURED", durationDays: 30 },
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------------------------------------------------------- serializer + filter
  it("exposes badges priority-ordered and supports the badge filter on browse", async () => {
    // A fresh listing that earns RA_VERIFIED + RA_ASSURED and is Instant-Book eligible.
    const F = await makeListing("Filter PG", ["wifi", "food"], true);
    const fRoom = await prisma.room.create({ data: { listingId: F.id, name: "R1", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 } });
    await prisma.bed.create({ data: { roomId: fRoom.id, label: `B-${randomUUID().slice(0, 8)}`, status: "AVAILABLE" } });
    await prisma.listingPhoto.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ listingId: F.id, url: `https://cdn/y/${randomUUID()}.jpg`, sortOrder: i })) });
    const visit = await prisma.agentVisit.create({ data: { listingId: F.id, agentId: agent.id, scheduledAt: now, status: "COMPLETED" } });
    await prisma.propertyInspection.create({ data: { visitId: visit.id, agentId: agent.id, listingId: F.id, status: "APPROVED", amenities: { wifi: "YES", food: "YES" }, reviewedAt: now } });

    await badgeService.reevaluateListing(F.id, DURABLE_BADGE_KINDS, { now });

    // Priority order: RA_ASSURED (4) < RA_VERIFIED (5) < INSTANT_BOOK (7, derived).
    expect(await activeBadgeKinds(F.id)).toEqual(["RA_ASSURED", "RA_VERIFIED", "INSTANT_BOOK"]);

    // The badge filter returns F for RA_ASSURED and omits a bare listing.
    const bare = await makeListing("Bare PG", ["wifi"]);
    const filtered = await app.inject({ method: "GET", url: "/v1/listings?badge=RA_ASSURED&limit=50" });
    const ids = (filtered.json().items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(F.id);
    expect(ids).not.toContain(bare.id);
  });
});
