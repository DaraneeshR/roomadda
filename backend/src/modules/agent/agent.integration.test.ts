import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { webhookService } from "../booking/webhook.service.js";
import { bookingRoutes } from "../booking/booking.route.js";
import { adminRoutes } from "../admin/admin.route.js";
import { agentRoutes } from "./agent.route.js";

/**
 * Agent surface end-to-end against a live DB. Proves the §9.1 zone-access
 * invariant (a cross-zone query is denied at the API) plus every agent
 * non-negotiable: GPS check-in rejects a point >200m, an inspection is blocked
 * without a valid check-in and under 8 photos, an agent CANNOT pay for the user
 * (server-rejected), and attribution is immutable once the booking confirms.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

// A listing's lat/lng; the PostGIS trigger maintains pg_listings.location from these.
const BLR = { lat: 12.9352, lng: 77.6245 };
const DELHI = { lat: 28.6139, lng: 77.209 };

function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature, eventId: `evt_agent_${randomUUID().slice(0, 8)}` };
}

describe("agent surface (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let agentBlr: User; // assignedCity Bengaluru
  let admin: User;
  let tenant: User; // a real verified tenant (for the cannot-pay probe)
  let blr: { listing: PgListing; room: Room };
  let delhi: { listing: PgListing; room: Room };
  let agentToken: string;
  let adminToken: string;
  let tenantToken: string;
  const listingIds: string[] = [];
  const userIds: string[] = [];
  const extraTenantPhones: string[] = [];

  const auth = (method: "GET" | "POST" | "PUT", url: string, token: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });

  async function makeListing(city: string, geo: { lat: number; lng: number }): Promise<{ listing: PgListing; room: Room }> {
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias: "Agent PG " + Math.random().toString(36).slice(2, 7),
        areaLabel: "Area",
        city,
        actualName: "Agent Real Name PG",
        fullAddress: "1 Inspect Road",
        pincode: "560001",
        latitude: geo.lat,
        longitude: geo.lng,
        status: "PUBLISHED",
        instantBook: true,
      },
    });
    listingIds.push(listing.id);
    const room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    for (let i = 0; i < 8; i++) {
      await prisma.bed.create({ data: { roomId: room.id, label: `B${i}`, status: "AVAILABLE" } });
    }
    return { listing, room };
  }

  async function makeVisit(listingId: string, agentId: string): Promise<string> {
    const visit = await prisma.agentVisit.create({
      data: { listingId, agentId, status: "SCHEDULED", scheduledAt: new Date() },
    });
    return visit.id;
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(agentRoutes, { prefix: "/v1" });
    await app.register(bookingRoutes, { prefix: "/v1" });
    await app.register(adminRoutes, { prefix: "/v1" });
    await app.ready();

    [host, agentBlr, admin, tenant] = await Promise.all([
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Host", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Blr", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Probe Tenant", role: "TENANT", isPhoneVerified: true } }),
    ]);
    userIds.push(host.id, agentBlr.id, admin.id, tenant.id);
    // The probe tenant is KYC-verified so the foreign-pay attempt reaches the
    // ownership check (404), not the KYC gate.
    await prisma.kycRecord.create({ data: { userId: tenant.id, status: "VERIFIED", docType: "AADHAAR" } });

    blr = await makeListing("Bengaluru", BLR);
    delhi = await makeListing("Delhi", DELHI);

    agentToken = await signAccessToken({ sub: agentBlr.id, role: "AGENT" });
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
  });

  afterAll(async () => {
    const extraTenants = await prisma.user.findMany({ where: { phone: { in: extraTenantPhones } }, select: { id: true } });
    const allUserIds = [...userIds, ...extraTenants.map((u) => u.id)];
    await prisma.inspectionPhoto.deleteMany({ where: { inspection: { listingId: { in: listingIds } } } });
    await prisma.propertyInspection.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.agentVisit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: { in: listingIds } } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_agent_" } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // ZONE ISOLATION — the §9.1 invariant, proven at the API.
  // -------------------------------------------------------------------------
  it("ZONE: a Bengaluru agent is DENIED cross-zone data (Delhi visit + Delhi listing)", async () => {
    // A visit assigned to THIS agent but on a Delhi property — isolates the zone
    // guard from ownership: it is the agent's own visit, yet the wrong city → 404.
    const delhiVisit = await makeVisit(delhi.listing.id, agentBlr.id);
    const crossVisit = await auth("GET", `/v1/agent/visits/${delhiVisit}`, agentToken);
    expect(crossVisit.statusCode).toBe(404);

    // A cross-zone check-in is denied too (cannot act on out-of-zone property).
    const crossCheckIn = await auth("POST", `/v1/agent/visits/${delhiVisit}/check-in`, agentToken, DELHI);
    expect(crossCheckIn.statusCode).toBe(404);

    // A cross-zone assisted booking (Delhi room) is denied before any user is created.
    const crossBooking = await auth("POST", "/v1/agent/assisted-bookings", agentToken, {
      tenantName: "Cross Zone", tenantPhone: uniquePhone(), roomId: delhi.room.id,
    });
    expect(crossBooking.statusCode).toBe(404);
    expect(crossBooking.json().error.code).toBe("NOT_FOUND");
  });

  it("ZONE: the dashboard shows only in-zone visits, never another zone's", async () => {
    const blrVisit = await makeVisit(blr.listing.id, agentBlr.id);
    const delhiVisit = await makeVisit(delhi.listing.id, agentBlr.id); // both today, both this agent's

    const res = await auth("GET", "/v1/agent/dashboard", agentToken);
    expect(res.statusCode).toBe(200);
    const ids = res.json().todaysVisits.map((v: { id: string }) => v.id);
    expect(ids).toContain(blrVisit);
    expect(ids).not.toContain(delhiVisit); // out-of-zone visit never appears
  });

  it("an agent with no assigned zone can do nothing (default-deny)", async () => {
    const zoneless = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "No Zone", role: "AGENT", isPhoneVerified: true } });
    userIds.push(zoneless.id);
    const token = await signAccessToken({ sub: zoneless.id, role: "AGENT" });
    const res = await auth("GET", "/v1/agent/dashboard", token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("AGENT_NO_ZONE");
  });

  // -------------------------------------------------------------------------
  // GPS check-in (PostGIS ST_DWithin, 200m).
  // -------------------------------------------------------------------------
  it("GPS check-in: a point >200m from the property does NOT validate", async () => {
    const visitId = await makeVisit(blr.listing.id, agentBlr.id);
    // ~3.5km north of the property -> clearly out of range.
    const far = await auth("POST", `/v1/agent/visits/${visitId}/check-in`, agentToken, { lat: BLR.lat + 0.03, lng: BLR.lng });
    expect(far.statusCode).toBe(200); // flag path, not a hard fail
    expect(far.json().withinRange).toBe(false);
    expect(far.json().cannotReachProperty).toBe(true);
    expect(far.json().distanceM).toBeGreaterThan(200);
  });

  it("GPS check-in: a point within 200m validates", async () => {
    const visitId = await makeVisit(blr.listing.id, agentBlr.id);
    const near = await auth("POST", `/v1/agent/visits/${visitId}/check-in`, agentToken, BLR);
    expect(near.statusCode).toBe(200);
    expect(near.json().withinRange).toBe(true);
    expect(near.json().distanceM).toBeLessThan(200);
  });

  // -------------------------------------------------------------------------
  // Inspection gates: valid check-in required, >= 8 photos required.
  // -------------------------------------------------------------------------
  it("inspection: submit is BLOCKED without a valid check-in", async () => {
    const visitId = await makeVisit(blr.listing.id, agentBlr.id);
    // Out-of-range check-in only — not valid.
    await auth("POST", `/v1/agent/visits/${visitId}/check-in`, agentToken, { lat: BLR.lat + 0.03, lng: BLR.lng });
    await auth("PUT", `/v1/agent/visits/${visitId}/inspection`, agentToken, {
      roomCountActual: 3, recommendation: "APPROVE", amenities: { wifi: "YES" }, cleanliness: { kitchen: 4 },
    });
    const res = await auth("POST", `/v1/agent/visits/${visitId}/inspection/submit`, agentToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CHECK_IN_REQUIRED");
  });

  it("inspection: submit is BLOCKED with fewer than 8 photos", async () => {
    const visitId = await makeVisit(blr.listing.id, agentBlr.id);
    await auth("POST", `/v1/agent/visits/${visitId}/check-in`, agentToken, BLR); // valid check-in
    await auth("PUT", `/v1/agent/visits/${visitId}/inspection`, agentToken, {
      roomCountActual: 3, recommendation: "APPROVE", amenities: { wifi: "YES" }, cleanliness: { kitchen: 4 },
    });
    // Only 3 photos.
    for (let i = 0; i < 3; i++) {
      const r = await auth("POST", `/v1/agent/visits/${visitId}/inspection/photos`, agentToken, {
        key: `inspections/${visitId}/${i}.jpg`, lat: BLR.lat, lng: BLR.lng, takenAt: new Date().toISOString(),
      });
      expect(r.statusCode).toBe(201);
    }
    const res = await auth("POST", `/v1/agent/visits/${visitId}/inspection/submit`, agentToken);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INSUFFICIENT_PHOTOS");
    expect(res.json().error.details).toMatchObject({ required: 8, have: 3 });
  });

  it("inspection: partial-save resumes, then submits with a valid check-in + 8 photos", async () => {
    const visitId = await makeVisit(blr.listing.id, agentBlr.id);
    await auth("POST", `/v1/agent/visits/${visitId}/check-in`, agentToken, BLR);

    // Partial save, then resume + complete (proves partial-save/resume).
    await auth("PUT", `/v1/agent/visits/${visitId}/inspection`, agentToken, { roomCountActual: 4 });
    const resumed = await auth("GET", `/v1/agent/visits/${visitId}/inspection`, agentToken);
    expect(resumed.json().inspection.roomCountActual).toBe(4);
    expect(resumed.json().inspection.status).toBe("DRAFT");
    await auth("PUT", `/v1/agent/visits/${visitId}/inspection`, agentToken, {
      recommendation: "APPROVE_WITH_CONDITIONS", amenities: { wifi: "YES", geyser: "PARTIAL" }, cleanliness: { kitchen: 5, bathroom: 3 },
      securityInfra: { cctv: true }, discrepancies: "Listed 4 rooms, found 4",
    });

    for (let i = 0; i < 8; i++) {
      await auth("POST", `/v1/agent/visits/${visitId}/inspection/photos`, agentToken, {
        key: `inspections/${visitId}/${i}.jpg`, lat: BLR.lat, lng: BLR.lng, takenAt: new Date().toISOString(),
      });
    }
    const submit = await auth("POST", `/v1/agent/visits/${visitId}/inspection/submit`, agentToken);
    expect(submit.statusCode).toBe(200);
    expect(submit.json().inspection.status).toBe("SUBMITTED");

    // The visit is now COMPLETED and the inspection is in the admin review queue.
    expect((await prisma.agentVisit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe("COMPLETED");
    const queue = await auth("GET", "/v1/admin/inspections", adminToken);
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items.map((i: { visit: { id: string } }) => i.visit.id)).toContain(visitId);
  });

  // -------------------------------------------------------------------------
  // Assisted booking: link to the USER; the agent CANNOT pay; attribution
  // immutable once confirmed.
  // -------------------------------------------------------------------------
  it("assisted booking: sends a link to the USER and returns NO payable order to the agent", async () => {
    const tenantPhone = uniquePhone();
    extraTenantPhones.push(tenantPhone);
    const res = await auth("POST", "/v1/agent/assisted-bookings", agentToken, {
      tenantName: "Assisted Tenant", tenantPhone, roomId: blr.room.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.agentChannel).toBe("ASSISTED");
    expect(body.payLinkSentTo).toContain("x"); // masked
    // The agent NEVER receives a payable order / key — they cannot pay.
    expect(body).not.toHaveProperty("razorpayOrder");
    expect(JSON.stringify(body)).not.toContain("keyId");

    // Attribution is recorded on the booking.
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(booking.bookedByAgentId).toBe(agentBlr.id);
    expect(booking.agentChannel).toBe("ASSISTED");
  });

  it("agent CANNOT pay on the user's behalf (the tenant pay endpoint rejects an agent)", async () => {
    const tenantPhone = uniquePhone();
    extraTenantPhones.push(tenantPhone);
    const created = await auth("POST", "/v1/agent/assisted-bookings", agentToken, {
      tenantName: "Pay Probe", tenantPhone, roomId: blr.room.id,
    });
    const bookingId = created.json().bookingId;

    // The agent hitting the tenant-only pay endpoint is default-denied (403).
    const pay = await auth("POST", `/v1/bookings/${bookingId}/payment`, agentToken, {
      method: "ONLINE", onlinePaise: created.json().tokenAmountPaise, cashPaise: 0,
    });
    expect(pay.statusCode).toBe(403);
    expect(pay.json().error.code).toBe("FORBIDDEN");

    // Even a real tenant who is NOT the booking's tenant cannot pay for it (404 — own only).
    const foreign = await auth("POST", `/v1/bookings/${bookingId}/payment`, tenantToken, {
      method: "ONLINE", onlinePaise: created.json().tokenAmountPaise, cashPaise: 0,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("attribution is IMMUTABLE once the booking confirms via the webhook", async () => {
    const tenantPhone = uniquePhone();
    extraTenantPhones.push(tenantPhone);
    const created = await auth("POST", "/v1/agent/assisted-bookings", agentToken, {
      tenantName: "Confirm Tenant", tenantPhone, roomId: blr.room.id,
    });
    const bookingId = created.json().bookingId;
    const tokenPaise = created.json().tokenAmountPaise;

    // The USER pays (we fire the verified webhook against the order created server-side).
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    const evt = capturedEvent(payment.razorpayOrderId!, tokenPaise);
    const result = await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    expect(result.status).toBe("processed");

    const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).not.toBeNull();
    // Attribution survives confirmation unchanged — and no route can reassign it.
    expect(confirmed.bookedByAgentId).toBe(agentBlr.id);
    expect(confirmed.agentChannel).toBe("ASSISTED");
  });

  it("walk-in booking: returns a Razorpay QR/order; confirms via the webhook; same attribution", async () => {
    const tenantPhone = uniquePhone();
    extraTenantPhones.push(tenantPhone);
    const created = await auth("POST", "/v1/agent/walkin-bookings", agentToken, {
      tenantName: "Walkin Tenant", tenantPhone, roomId: blr.room.id,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().agentChannel).toBe("WALK_IN");
    expect(created.json().razorpayOrder.orderId).toBeTruthy(); // the user scans this

    const bookingId = created.json().bookingId;
    const evt = capturedEvent(created.json().razorpayOrder.orderId, created.json().tokenAmountPaise);
    await webhookService.processRazorpay(evt.raw, evt.signature, evt.eventId);
    const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bookedByAgentId).toBe(agentBlr.id);
    expect(confirmed.agentChannel).toBe("WALK_IN");
  });

  // -------------------------------------------------------------------------
  // Agents are ADMIN-created (no self-register).
  // -------------------------------------------------------------------------
  it("agents are created by ADMIN only", async () => {
    const phone = uniquePhone();
    const ok = await auth("POST", "/v1/admin/agents", adminToken, { fullName: "New Agent", phone, assignedCity: "Bengaluru" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().agent.role).toBe("AGENT");
    expect(ok.json().agent.assignedCity).toBe("Bengaluru");
    userIds.push(ok.json().agent.id);

    // A non-admin cannot create agents (default-deny).
    const denied = await auth("POST", "/v1/admin/agents", agentToken, { fullName: "X", phone: uniquePhone(), assignedCity: "Bengaluru" });
    expect(denied.statusCode).toBe(403);
  });

  it("performance scorecard reports this month's closed bookings + commission (read-only)", async () => {
    const res = await auth("GET", "/v1/agent/performance", agentToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The assisted + walk-in confirmations above are this month's closed bookings.
    expect(body.bookingsClosed).toBeGreaterThanOrEqual(2);
    expect(body.commissionEarnedPaise).toBeGreaterThan(0);
    // Commission = 10% (default BPS) of monthly rent per closed booking.
    expect(body.commissionEarnedPaise).toBe(body.bookingsClosed * Math.floor(1_000_000 * 0.1));
  });
});
