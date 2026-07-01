import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Booking, PgListing, Room, ServiceRequestPriority, ServiceRequestStatus, User } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { serviceRequestRoutes } from "./service-request.route.js";
import { serviceRequestService } from "./service-request.service.js";

/**
 * Maintenance service-request flow against a live DB: a tenant on an active stay
 * raises a ticket (gets a ticket number) and tracks it, comments are append-only
 * (no delete route exists), rating is gated to RESOLVED, and Urgent requests
 * unresolved past the window auto-escalate. Ownership is enforced (foreign 404).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const HOUR_MS = 60 * 60 * 1000;

describe("service requests (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User; // has an active stay
  let other: User; // a tenant with NO active stay
  let listing: PgListing;
  let room: Room;
  let booking: Booking;
  let tenantToken: string;
  let otherToken: string;
  let hostToken: string;
  const listingIds: string[] = [];

  let ticketSeq = 0;
  function seed(opts: { priority?: ServiceRequestPriority; status?: ServiceRequestStatus; escalated?: boolean; createdAt?: Date }) {
    ticketSeq++;
    return prisma.serviceRequest.create({
      data: {
        ticketNumber: `SR-SEED${ticketSeq.toString().padStart(3, "0")}`,
        bookingId: booking.id,
        tenantId: tenant.id,
        listingId: listing.id,
        category: "PLUMBING",
        description: "Seeded request",
        priority: opts.priority ?? "NORMAL",
        status: opts.status ?? "SUBMITTED",
        escalated: opts.escalated ?? false,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
  }

  const send = (method: "GET" | "POST" | "DELETE", url: string, token?: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(payload ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(serviceRequestRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "SR Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "SR Tenant", role: "TENANT", isPhoneVerified: true } });
    other = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "No Stay", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "SR PG", areaLabel: "Area", city: "City",
        actualName: "SR Real Name", fullAddress: "1 SR Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    listingIds.push(listing.id);
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 6)}`, status: "BOOKED" } });
    // Active stay: CONFIRMED + moved in yesterday.
    booking = await prisma.booking.create({
      data: {
        bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "CONFIRMED",
        tokenAmountPaise: 500_000, monthlyRentPaise: 1_000_000, depositPaise: 500_000,
        moveInDate: new Date(Date.now() - 24 * HOUR_MS), confirmedAt: new Date(),
      },
    });

    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    otherToken = await signAccessToken({ sub: other.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.serviceRequestComment.deleteMany({ where: { request: { listingId: { in: listingIds } } } });
    await prisma.serviceRequest.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, other.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("a tenant on an active stay creates a request and gets a ticket number", async () => {
    const res = await send("POST", "/v1/service-requests", tenantToken, {
      category: "ELECTRICAL", description: "Fan not working", priority: "NORMAL",
    });
    expect(res.statusCode).toBe(201);
    const req = res.json().request;
    expect(req.ticketNumber).toMatch(/^SR-[0-9A-F]{6}$/);
    expect(req.status).toBe("SUBMITTED");
    expect(req.category).toBe("ELECTRICAL");
    expect(req.photoCount).toBe(0);
    expect(req.escalated).toBe(false);
    expect(req.comments).toEqual([]);
  });

  it("requires an active stay — a tenant without one is rejected", async () => {
    const res = await send("POST", "/v1/service-requests", otherToken, {
      category: "PLUMBING", description: "Tap leaking",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_STAY");
  });

  it("a tenant cannot delete a submitted request (no delete route exists)", async () => {
    const created = await send("POST", "/v1/service-requests", tenantToken, {
      category: "CLEANING", description: "Room cleaning",
    });
    const id = created.json().request.id;

    const del = await send("DELETE", `/v1/service-requests/${id}`, tenantToken);
    expect(del.statusCode).toBe(404); // method/route not found — tenants can't delete

    // And the request is still there.
    const still = await send("GET", `/v1/service-requests/${id}`, tenantToken);
    expect(still.statusCode).toBe(200);
    expect(still.json().request.id).toBe(id);
  });

  it("supports follow-up comments (append-only)", async () => {
    const created = await send("POST", "/v1/service-requests", tenantToken, {
      category: "WIFI", description: "No internet",
    });
    const id = created.json().request.id;

    const res = await send("POST", `/v1/service-requests/${id}/comments`, tenantToken, { body: "Still down this morning" });
    expect(res.statusCode).toBe(201);
    const comments = res.json().request.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Still down this morning");
    expect(comments[0].authorRole).toBe("TENANT");
    expect(comments[0].authorName).toBe("SR Tenant");
  });

  it("rating is allowed only once the request is RESOLVED", async () => {
    const created = await send("POST", "/v1/service-requests", tenantToken, {
      category: "APPLIANCE", description: "Geyser broken", priority: "URGENT",
    });
    const id = created.json().request.id;

    const early = await send("POST", `/v1/service-requests/${id}/rating`, tenantToken, { rating: 5 });
    expect(early.statusCode).toBe(409); // RATING_NOT_ALLOWED

    // Host/admin resolves it (simulated directly — that transition lands in the host phase).
    await prisma.serviceRequest.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });

    const rated = await send("POST", `/v1/service-requests/${id}/rating`, tenantToken, { rating: 4 });
    expect(rated.statusCode).toBe(200);
    expect(rated.json().request.rating).toBe(4);
  });

  it("a foreign request id returns 404 (not 403)", async () => {
    const created = await send("POST", "/v1/service-requests", tenantToken, {
      category: "OTHER", description: "Spare key",
    });
    const id = created.json().request.id;
    const res = await send("GET", `/v1/service-requests/${id}`, otherToken);
    expect(res.statusCode).toBe(404);
  });

  it("auto-escalates Urgent requests unresolved past the 4h window", async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * HOUR_MS);
    const urgentOld = await seed({ priority: "URGENT", createdAt: fiveHoursAgo });
    const normalOld = await seed({ priority: "NORMAL", createdAt: fiveHoursAgo });
    const urgentRecent = await seed({ priority: "URGENT", createdAt: new Date() });
    const urgentResolvedOld = await seed({ priority: "URGENT", status: "RESOLVED", createdAt: fiveHoursAgo });

    const count = await serviceRequestService.escalateOverdueUrgent(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const reload = (id: string) => prisma.serviceRequest.findUnique({ where: { id } });
    expect((await reload(urgentOld.id))?.escalated).toBe(true);
    expect((await reload(urgentOld.id))?.escalatedAt).not.toBeNull();
    expect((await reload(normalOld.id))?.escalated).toBe(false); // not urgent
    expect((await reload(urgentRecent.id))?.escalated).toBe(false); // within the window
    expect((await reload(urgentResolvedOld.id))?.escalated).toBe(false); // already resolved

    // Idempotent: a second sweep does not re-escalate the same row.
    const before = (await reload(urgentOld.id))?.escalatedAt;
    await serviceRequestService.escalateOverdueUrgent(new Date());
    expect((await reload(urgentOld.id))?.escalatedAt?.getTime()).toBe(before?.getTime());

    // The escalated ticket surfaces in admin oversight (escalated first).
    const adminPage = await serviceRequestService.listForAdmin({ escalated: true, limit: 50 });
    expect(adminPage.items.some((r) => r.id === urgentOld.id)).toBe(true);
    const item = adminPage.items.find((r) => r.id === urgentOld.id);
    expect(item?.tenant.fullName).toBe("SR Tenant");
    expect(item?.listing.alias).toBe("SR PG");
  });

  it("rejects a non-TENANT role (403) and an unauthenticated caller (401)", async () => {
    expect((await send("GET", "/v1/service-requests", hostToken)).statusCode).toBe(403);
    expect((await send("GET", "/v1/service-requests")).statusCode).toBe(401);
  });
});
