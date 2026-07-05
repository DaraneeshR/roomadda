import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { agentRoutes } from "./agent.route.js";
import { erpRoutes } from "../erp/erp.route.js";
import { agentCommissionPaise } from "../erp/erp.engine.js";
import type {
  AgentErpBookingDetail,
  AgentErpBookingsResponse,
  AgentErpHome,
  AgentErpPerformance,
  AgentSubmitBookingResult,
  BookingApprovalsResponse,
} from "@roomadda/shared";

/**
 * ERP-6 — the scoped agent ERP view (§15.4) end-to-end against a live Postgres.
 * Proves the §15.4 privacy invariant: an agent sees ONLY their own bookings /
 * commission / rank; a cross-agent booking is a 404; a submitted booking flows into
 * the SHARED admin approval queue (ERP-2); the agent's commission == the ONE engine
 * definition; and NO company-finance figure (collected / paidToPg / net / settlement)
 * — nor any admin ERP endpoint — is ever reachable by an agent. BPS = 1000.
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;
const CITY = "Bengaluru";

const RENT_A1 = 3_000_000, RENT_A2 = 2_000_000, RENT_B1 = 1_000_000;
const COMM_A1 = agentCommissionPaise(RENT_A1, BPS);
const COMM_A2 = agentCommissionPaise(RENT_A2, BPS);

/** Field names that would betray company finance — must NEVER appear in an agent payload. */
const COMPANY_FINANCE = /paidToPg|collectedPaise|"netPaise"|settlement|receivedNet|pendingNet/i;

describe("erp-6 scoped agent ERP view (§15.4, integration)", () => {
  let app: FastifyInstance;
  let admin: User, host: User, tenant: User, agentA: User, agentB: User;
  let property: PgListing;
  let adminToken: string, tokenA: string, tokenB: string;
  let bookingA1: Booking, bookingA2: Booking, bookingB1: Booking;
  let submitBedId: string;

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];

  const mkRoomBed = async (rentPaise: number, bedStatus: "BOOKED" | "AVAILABLE"): Promise<{ roomId: string; bedId: string }> => {
    const room = await prisma.room.create({
      data: { listingId: property.id, name: `R-${randomUUID().slice(0, 6)}`, sharingType: 2, monthlyRentPaise: rentPaise, depositPaise: 0 },
    });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: bedStatus } });
    return { roomId: room.id, bedId: bed.id };
  };

  const mkConfirmed = async (agentId: string, rentPaise: number): Promise<Booking> => {
    const { bedId } = await mkRoomBed(rentPaise, "BOOKED");
    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        bedId, tenantId: tenant.id, listingId: property.id, status: "CONFIRMED",
        tokenAmountPaise: 500_000, monthlyRentPaise: rentPaise, depositPaise: 0,
        moveInDate: now, createdAt: now, confirmedAt: now,
        bookedByAgentId: agentId, agentChannel: "ASSISTED",
      },
    });
    bookingIds.push(booking.id);
    return booking;
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(agentRoutes, { prefix: "/v1" });
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP6 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya PgOwner", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Ravi Tenant", role: "TENANT", isPhoneVerified: true } });
    agentA = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: CITY, isPhoneVerified: true } });
    agentB = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Bala Agent", role: "AGENT", assignedCity: CITY, isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, agentA.id, agentB.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    tokenA = await signAccessToken({ sub: agentA.id, role: "AGENT" });
    tokenB = await signAccessToken({ sub: agentB.id, role: "AGENT" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP6-Nest-${randomUUID().slice(0, 6)}`, areaLabel: "Indiranagar", city: CITY, actualName: "Nest PG", fullAddress: "2 Rd", pincode: "560038", latitude: 12.97, longitude: 77.64, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    bookingA1 = await mkConfirmed(agentA.id, RENT_A1);
    bookingA2 = await mkConfirmed(agentA.id, RENT_A2);
    bookingB1 = await mkConfirmed(agentB.id, RENT_B1);
    submitBedId = (await mkRoomBed(RENT_A1, "AVAILABLE")).bedId;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.booking.deleteMany({ where: { OR: [{ id: { in: bookingIds } }, { bookedByAgentId: { in: [agentA.id, agentB.id] } }] } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it("home: my bookings / approved / commission (== engine), own data only", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agent/erp/home", headers: auth(tokenA) });
    expect(res.statusCode).toBe(200);
    const home = res.json() as AgentErpHome;
    expect(home.approvedCount).toBe(2); // agent A's two confirmed bookings
    expect(home.commissionEarnedPaise).toBe(COMM_A1 + COMM_A2); // == the one engine definition
    expect(home.rank).toBeGreaterThanOrEqual(1);
    expect(home.totalAgents).toBeGreaterThanOrEqual(2);
    expect(res.payload).not.toMatch(COMPANY_FINANCE);
  });

  it("leaderboard rank is own-position only, and reflects the engine ranking (A earns more than B)", async () => {
    const a = (await app.inject({ method: "GET", url: "/v1/agent/erp/home", headers: auth(tokenA) })).json() as AgentErpHome;
    const b = (await app.inject({ method: "GET", url: "/v1/agent/erp/home", headers: auth(tokenB) })).json() as AgentErpHome;
    // A (₹5,000 commission) outranks B (₹1,000): a better (lower) rank number.
    expect(a.rank!).toBeLessThan(b.rank!);
    // The payload exposes only the caller's rank + field size — never another agent's figure.
    expect(Object.keys(a)).not.toContain("leaderboard");
  });

  it("bookings ledger: only MY bookings, commission == engine, no company-finance fields", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agent/erp/bookings?limit=50", headers: auth(tokenA) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentErpBookingsResponse;

    const ids = body.items.map((i) => i.bookingId).sort();
    expect(ids).toEqual([bookingA1.id, bookingA2.id].sort()); // agent B's booking is absent
    expect(body.items.some((i) => i.bookingId === bookingB1.id)).toBe(false);

    const a1 = body.items.find((i) => i.bookingId === bookingA1.id)!;
    expect(a1.commissionEarnedPaise).toBe(COMM_A1);
    expect(res.payload).not.toMatch(COMPANY_FINANCE);
  });

  it("booking detail is self+zone scoped: own booking opens; a cross-agent id is 404", async () => {
    const own = await app.inject({ method: "GET", url: `/v1/agent/erp/bookings/${bookingA1.id}`, headers: auth(tokenA) });
    expect(own.statusCode).toBe(200);
    const detail = own.json() as AgentErpBookingDetail;
    expect(detail.commissionEarnedPaise).toBe(COMM_A1);
    expect(detail.customer.fullName).toBe("Ravi Tenant");
    expect(detail.room.bedId).toBeTruthy();
    expect(own.payload).not.toMatch(COMPANY_FINANCE);

    // Agent A asking for Agent B's booking → 404 (existence never leaked).
    const cross = await app.inject({ method: "GET", url: `/v1/agent/erp/bookings/${bookingB1.id}`, headers: auth(tokenA) });
    expect(cross.statusCode).toBe(404);
    // And the reverse.
    const crossB = await app.inject({ method: "GET", url: `/v1/agent/erp/bookings/${bookingA1.id}`, headers: auth(tokenB) });
    expect(crossB.statusCode).toBe(404);
  });

  it("performance: totals + conversion + commission (== engine) + tier, no company-finance", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agent/erp/performance", headers: auth(tokenA) });
    expect(res.statusCode).toBe(200);
    const perf = res.json() as AgentErpPerformance;
    expect(perf.approved).toBe(2);
    expect(perf.commissionEarnedPaise).toBe(COMM_A1 + COMM_A2);
    expect(perf.conversionRate).toBeGreaterThan(0);
    expect(perf.tier.name).toBe("Bronze"); // 2 approved → Bronze
    expect(res.payload).not.toMatch(COMPANY_FINANCE);
  });

  it("HARD boundary: an agent cannot reach ANY admin/company-finance ERP endpoint (403)", async () => {
    for (const url of [
      "/v1/erp/dashboard",
      "/v1/erp/money-manager",
      "/v1/erp/agents",
      "/v1/erp/commission",
      "/v1/erp/ca-pack",
      "/v1/erp/bookings",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(tokenA) });
      expect(res.statusCode).toBe(403);
    }
  });

  it("a submitted booking flows into the SHARED admin approval queue (ERP-2)", async () => {
    const submit = await app.inject({
      method: "POST",
      url: "/v1/agent/erp/submissions",
      headers: auth(tokenA),
      payload: {
        tenantName: "Guest Kumar",
        tenantPhone: uniquePhone(),
        bedId: submitBedId,
        moveInDate: new Date().toISOString(),
        monthlyRentPaise: 2_400_000,
        depositPaise: 1_000_000,
        tokenAmountPaise: 500_000,
        agentChannel: "WALK_IN",
        kyc: { docType: "AADHAAR", aadhaarFrontKey: "agent-submissions/x/kyc/front.jpg", aadhaarBackKey: "agent-submissions/x/kyc/back.jpg" },
        paymentProofKey: "agent-submissions/x/payment-proof/proof.jpg",
      },
    });
    expect(submit.statusCode).toBe(201);
    const result = submit.json() as AgentSubmitBookingResult;
    expect(result.booking.approval).toBe("PENDING");
    const submittedId = result.booking.bookingId;
    bookingIds.push(submittedId);

    // The bed is now HELD (the one-live-booking invariant holds).
    const bed = await prisma.bed.findUnique({ where: { id: submitBedId }, select: { status: true } });
    expect(bed!.status).toBe("HELD");

    // Attribution is the submitting agent, and the booking is PENDING_APPROVAL.
    const row = await prisma.booking.findUnique({ where: { id: submittedId }, select: { bookedByAgentId: true, status: true, paymentProofKey: true } });
    expect(row!.bookedByAgentId).toBe(agentA.id);
    expect(row!.status).toBe("PENDING_APPROVAL");
    expect(row!.paymentProofKey).toBeTruthy();

    // It appears in the SAME queue the admin reviews (ERP-2).
    const queue = await app.inject({ method: "GET", url: "/v1/erp/approvals?limit=50", headers: auth(adminToken) });
    expect(queue.statusCode).toBe(200);
    const items = (queue.json() as BookingApprovalsResponse).items;
    expect(items.some((i) => i.bookingId === submittedId)).toBe(true);
  });
});
