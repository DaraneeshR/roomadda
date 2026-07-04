import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { adminRoutes } from "./admin.route.js";
import { badgeAdminRoutes } from "../badge/badge.route.js";
import { cmsRoutes } from "../cms/cms.route.js";
import { broadcastRoutes } from "../notification/broadcast.route.js";

/**
 * Admin console (§7) end-to-end against a live Postgres. Proves the six new
 * surfaces are ADMIN-gated, that every state change writes an AuditLog, that an
 * admin can never fake-grant a rule badge (only suspend/grant-Featured), that the
 * broadcast weekly rate cap holds, and that "contact host" never shares a phone.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("admin console (§7, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let host: User;
  let tenant: User;
  let agent: User;
  let listing: PgListing; // in Bengaluru
  let mumbaiListing: PgListing;
  let serviceRequestId: string;
  let adminToken: string;
  let hostToken: string;

  const userIds: string[] = [];
  const listingIds: string[] = [];

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(adminRoutes, { prefix: "/v1" });
    await app.register(badgeAdminRoutes, { prefix: "/v1" });
    await app.register(cmsRoutes, { prefix: "/v1" });
    await app.register(broadcastRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host Harish", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant Tara", role: "TENANT", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Anu", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, agent.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });

    await prisma.kycRecord.create({ data: { userId: host.id, status: "VERIFIED", docType: "AADHAAR", verifiedAt: new Date() } });

    const mkListing = async (city: string): Promise<PgListing> => {
      const l = await prisma.pgListing.create({
        data: {
          hostId: host.id, alias: `${city} PG`, areaLabel: "Area", city,
          actualName: "Real Name", fullAddress: "1 Road", pincode: "560001",
          latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
        },
      });
      listingIds.push(l.id);
      return l;
    };
    listing = await mkListing("Bengaluru");
    mumbaiListing = await mkListing("Mumbai");

    // A bed-backed CONFIRMED booking to hang a service request off.
    const room = await prisma.room.create({ data: { listingId: listing.id, name: "R1", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 0 } });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: "BOOKED" } });
    const booking = await prisma.booking.create({
      data: { bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "CONFIRMED", tokenAmountPaise: 500_000, monthlyRentPaise: 1_000_000, depositPaise: 0 },
    });
    const sr = await prisma.serviceRequest.create({
      data: {
        ticketNumber: `SR-${randomUUID().slice(0, 6).toUpperCase()}`,
        bookingId: booking.id, tenantId: tenant.id, listingId: listing.id,
        category: "PLUMBING", description: "Leaking tap", priority: "URGENT",
        status: "SUBMITTED", escalated: true, escalatedAt: new Date(),
      },
    });
    serviceRequestId = sr.id;

    // A rule badge to exercise suspend.
    await prisma.trustTag.create({ data: { listingId: listing.id, kind: "RA_VERIFIED", source: "RULE", earnedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.hostFlag.deleteMany({ where: { hostId: host.id } });
    await prisma.adminBroadcast.deleteMany({ where: { createdById: admin.id } });
    await prisma.faq.deleteMany({ where: { question: { startsWith: "CONSOLE-TEST" } } });
    await prisma.trustTag.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.agentVisit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.serviceRequestComment.deleteMany({ where: { requestId: serviceRequestId } });
    await prisma.serviceRequest.deleteMany({ where: { id: serviceRequestId } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const auditCount = (action: string, targetId?: string) =>
    prisma.auditLog.count({ where: { action, actorId: admin.id, ...(targetId ? { targetId } : {}) } });

  // ---------------------------------------------------------- ADMIN-only gate
  it("blocks a non-admin (403) and an anonymous caller (401) across the new surfaces", async () => {
    const paths = [
      { method: "GET" as const, url: "/v1/admin/service-requests" },
      { method: "GET" as const, url: "/v1/admin/hosts" },
      { method: "GET" as const, url: "/v1/admin/agents-list" },
      { method: "GET" as const, url: "/v1/admin/broadcasts" },
      { method: "GET" as const, url: "/v1/admin/cms/faqs" },
    ];
    for (const p of paths) {
      const forbidden = await app.inject({ ...p, headers: auth(hostToken) });
      expect(forbidden.statusCode, `${p.url} host`).toBe(403);
      const anon = await app.inject(p);
      expect(anon.statusCode, `${p.url} anon`).toBe(401);
    }
  });

  it("keeps public content reads open (no auth)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/content/faqs" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  // ---------------------------------------------------- service-request oversight
  it("lists escalated requests, reads the full ticket, and never shares the host phone", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/admin/service-requests?escalated=true", headers: auth(adminToken) });
    expect(list.statusCode).toBe(200);
    expect((list.json().items as Array<{ id: string }>).some((i) => i.id === serviceRequestId)).toBe(true);

    const detail = await app.inject({ method: "GET", url: `/v1/admin/service-requests/${serviceRequestId}`, headers: auth(adminToken) });
    expect(detail.statusCode).toBe(200);
    const req = detail.json().request;
    expect(req.host.id).toBe(host.id);
    expect(req.host.phone).toBeUndefined(); // no phone sharing
    expect(req.tenant.phone).toBeDefined(); // tenant contact IS visible to admin
  });

  it("contacts the host (audited) and resolves on the host's behalf (audited)", async () => {
    const contact = await app.inject({
      method: "POST", url: `/v1/admin/service-requests/${serviceRequestId}/contact-host`,
      headers: auth(adminToken), payload: { message: "Please attend to the leaking tap today." },
    });
    expect(contact.statusCode).toBe(201);
    expect((contact.json().request.comments as Array<{ authorRole: string }>).some((c) => c.authorRole === "ADMIN")).toBe(true);
    expect(await auditCount("service_request.host_contacted", serviceRequestId)).toBe(1);

    const resolve = await app.inject({
      method: "POST", url: `/v1/admin/service-requests/${serviceRequestId}/resolve`,
      headers: auth(adminToken), payload: { reason: "Vendor dispatched, confirmed fixed." },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().request.status).toBe("RESOLVED");
    expect(await auditCount("service_request.resolved_by_admin", serviceRequestId)).toBe(1);
  });

  // ---------------------------------------------------------------- host mgmt
  it("shows escalation history on the host profile, flags the host (audited), and suspends/reinstates (audited)", async () => {
    const detail = await app.inject({ method: "GET", url: `/v1/admin/hosts/${host.id}`, headers: auth(adminToken) });
    expect(detail.statusCode).toBe(200);
    expect((detail.json().host.escalations as Array<{ id: string }>).some((e) => e.id === serviceRequestId)).toBe(true);

    const flag = await app.inject({
      method: "POST", url: `/v1/admin/hosts/${host.id}/flag`,
      headers: auth(adminToken), payload: { reason: "Slow to respond", serviceRequestId },
    });
    expect(flag.statusCode).toBe(201);
    expect(flag.json().host.flags.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.hostFlag.count({ where: { hostId: host.id } })).toBe(1);
    expect(await auditCount("host.flagged", host.id)).toBe(1);

    const suspend = await app.inject({
      method: "POST", url: `/v1/admin/hosts/${host.id}/moderate`,
      headers: auth(adminToken), payload: { action: "SUSPEND", reason: "Repeated non-response" },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().host.status).toBe("SUSPENDED");
    expect((await prisma.user.findUnique({ where: { id: host.id } }))?.status).toBe("SUSPENDED");
    expect(await auditCount("user.suspended", host.id)).toBe(1);

    // Reinstate so later host-scoped assertions aren't affected.
    const reinstate = await app.inject({
      method: "POST", url: `/v1/admin/hosts/${host.id}/moderate`,
      headers: auth(adminToken), payload: { action: "REINSTATE" },
    });
    expect(reinstate.json().host.status).toBe("ACTIVE");
    expect(await auditCount("user.reinstated", host.id)).toBe(1);
  });

  it("requires a reason to suspend (400) and rejects a non-admin (403)", async () => {
    const noReason = await app.inject({
      method: "POST", url: `/v1/admin/hosts/${host.id}/moderate`, headers: auth(adminToken), payload: { action: "SUSPEND" },
    });
    expect(noReason.statusCode).toBe(400); // zod refine rejects at the boundary

    const notAdmin = await app.inject({
      method: "POST", url: `/v1/admin/hosts/${host.id}/moderate`, headers: auth(hostToken), payload: { action: "BAN", reason: "x" },
    });
    expect(notAdmin.statusCode).toBe(403);
  });

  // ------------------------------------------------------------- badge control
  it("admin cannot fake-grant a rule badge (403) but can schedule Featured and suspend a rule badge (audited)", async () => {
    const fake = await app.inject({
      method: "POST", url: `/v1/admin/listings/${listing.id}/badges`,
      headers: auth(adminToken), payload: { kind: "RA_ASSURED", durationDays: 30 },
    });
    expect(fake.statusCode).toBe(403);
    expect(fake.json().error.code).toBe("BADGE_NOT_GRANTABLE");

    // Schedule Featured to start in the future -> present but INACTIVE now.
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const grant = await app.inject({
      method: "POST", url: `/v1/admin/listings/${listing.id}/badges`,
      headers: auth(adminToken), payload: { kind: "FEATURED", startDate: start.toISOString(), endDate: end.toISOString() },
    });
    expect(grant.statusCode).toBe(201);

    const view = await app.inject({ method: "GET", url: `/v1/admin/listings/${listing.id}/badges`, headers: auth(adminToken) });
    const featured = (view.json().badges as Array<{ kind: string; active: boolean; startsAt: string | null; why: string }>).find((b) => b.kind === "FEATURED");
    expect(featured).toBeDefined();
    expect(featured!.active).toBe(false); // scheduled ahead
    expect(featured!.startsAt).not.toBeNull();
    expect(featured!.why).toMatch(/paid/i);

    // Suspend the rule badge with a logged reason.
    const suspend = await app.inject({
      method: "POST", url: `/v1/admin/listings/${listing.id}/badges/RA_VERIFIED/suspend`,
      headers: auth(adminToken), payload: { reason: "under manual review" },
    });
    expect(suspend.statusCode).toBe(200);
    expect((await prisma.trustTag.findUnique({ where: { listingId_kind: { listingId: listing.id, kind: "RA_VERIFIED" } } }))?.suspendedReason).toBe("under manual review");
    expect(await auditCount("badge.suspended", listing.id)).toBe(1);
  });

  // ------------------------------------------------------------- agent mgmt
  it("assigns an in-zone visit (audited), rejects an out-of-zone visit (422), and retunes territory (audited)", async () => {
    const inZone = await app.inject({
      method: "POST", url: "/v1/admin/agent-visits", headers: auth(adminToken),
      payload: { listingId: listing.id, agentId: agent.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(inZone.statusCode).toBe(201);
    expect(await auditCount("agent.visit_assigned", inZone.json().visit.id)).toBe(1);

    const outOfZone = await app.inject({
      method: "POST", url: "/v1/admin/agent-visits", headers: auth(adminToken),
      payload: { listingId: mumbaiListing.id, agentId: agent.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(outOfZone.statusCode).toBe(422);
    expect(outOfZone.json().error.code).toBe("AGENT_OUT_OF_ZONE");

    const territory = await app.inject({
      method: "PATCH", url: `/v1/admin/agents/${agent.id}/territory`, headers: auth(adminToken), payload: { assignedCity: "Mumbai" },
    });
    expect(territory.statusCode).toBe(200);
    expect(territory.json().agent.assignedCity).toBe("Mumbai");
    expect(await auditCount("agent.territory_changed", agent.id)).toBe(1);
  });

  // ------------------------------------------------------------- broadcasts
  it("enforces the platform-wide weekly broadcast cap and audits each create", async () => {
    const send = (title: string) =>
      app.inject({
        method: "POST", url: "/v1/admin/broadcasts", headers: auth(adminToken),
        payload: { channel: "PUSH", audience: "ALL_USERS", title, body: "hello" },
      });
    const first = await send("B1");
    const second = await send("B2");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().broadcast.status).toBe("SENT"); // scheduledAt omitted -> now
    expect(first.json().broadcast.recipientCount).toBeGreaterThanOrEqual(4); // the 4 seeded users

    const third = await send("B3");
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("BROADCAST_RATE_LIMITED");

    expect(await auditCount("broadcast.created")).toBe(2);
    expect(await auditCount("broadcast.sent")).toBe(2);
  });

  // ------------------------------------------------------------- CMS + SEO
  it("creates a FAQ (audited), publishes it to the public read, and deletes it (audited)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/cms/faqs", headers: auth(adminToken),
      payload: { question: "CONSOLE-TEST is RoomAdda safe?", answer: "Yes.", published: true },
    });
    expect(create.statusCode).toBe(201);
    const faqId = create.json().faq.id as string;
    expect(await auditCount("cms.faq.created", faqId)).toBe(1);

    const pub = await app.inject({ method: "GET", url: "/v1/content/faqs" });
    expect((pub.json().items as Array<{ id: string }>).some((f) => f.id === faqId)).toBe(true);

    const del = await app.inject({ method: "DELETE", url: `/v1/admin/cms/faqs/${faqId}`, headers: auth(adminToken) });
    expect(del.statusCode).toBe(204);
    expect(await auditCount("cms.faq.deleted", faqId)).toBe(1);
  });
});
