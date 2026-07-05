import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { agentCommissionPaise } from "./erp.engine.js";
import type { ErpAgentsResponse, ReassignBookingResult } from "@roomadda/shared";

/**
 * ERP-4 Agents (§15.3) end-to-end against a live Postgres. Proves the per-agent
 * scorecard (submitted / approved / conversion + incentive tier), the commission
 * leaderboard, and — the headline guarantee — that REASSIGNING a booking to another
 * agent moves the commission, updates BOTH agents' performance, and re-ranks the
 * leaderboard, all through the ONE engine commission definition (no separate path).
 *
 * Scoped to a dedicated property + FY2026 so the roll-ups are deterministic.
 * AGENT_COMMISSION_BPS default = 1000 (10%).
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;
const FY = 2026;
const WHEN = new Date(Date.UTC(2026, 4, 10)); // 10 May 2026 (in FY2026)

const RENT_A1 = 3_000_000; // → commission 300,000
const RENT_A2 = 2_000_000; // → commission 200,000
const RENT_B1 = 1_000_000; // → commission 100,000
const COMM_A1 = agentCommissionPaise(RENT_A1, BPS);
const COMM_A2 = agentCommissionPaise(RENT_A2, BPS);
const COMM_B1 = agentCommissionPaise(RENT_B1, BPS);

describe("erp-4 agents + reassignment (§15.3, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let host: User;
  let tenant: User;
  let agentA: User;
  let agentB: User;
  let property: PgListing;
  let adminToken: string;
  let bookingA1: Booking;
  let bookingA2: Booking;

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];

  const mkBooking = async (rentPaise: number, agentId: string): Promise<Booking> => {
    const room = await prisma.room.create({
      data: { listingId: property.id, name: `R-${randomUUID().slice(0, 6)}`, sharingType: 2, monthlyRentPaise: rentPaise, depositPaise: 0 },
    });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: "BOOKED" } });
    const booking = await prisma.booking.create({
      data: {
        bedId: bed.id,
        tenantId: tenant.id,
        listingId: property.id,
        status: "CONFIRMED",
        tokenAmountPaise: 500_000,
        monthlyRentPaise: rentPaise,
        depositPaise: 0,
        moveInDate: WHEN,
        bookedByAgentId: agentId,
        agentChannel: "ASSISTED",
        createdAt: WHEN,
        confirmedAt: WHEN,
      },
    });
    // A captured payment so the booking carries real collected money.
    const payment = await prisma.payment.create({
      data: { bookingId: booking.id, amountPaise: 500_000, status: "CAPTURED", method: "RAZORPAY", razorpayOrderId: `order_${randomUUID().slice(0, 12)}` },
    });
    await prisma.paymentTransaction.create({
      data: { paymentId: payment.id, amountPaise: 500_000, status: "CAPTURED", method: "RAZORPAY", razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}`, capturedAt: new Date() },
    });
    bookingIds.push(booking.id);
    return booking;
  };

  const getAgents = async (): Promise<ErpAgentsResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/agents?financialYear=${FY}&listingId=${property.id}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as ErpAgentsResponse;
  };
  const cardFor = (r: ErpAgentsResponse, id: string) => r.agents.find((a) => a.agentId === id)!;

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP4 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya PgOwner", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Ravi Tenant", role: "TENANT", isPhoneVerified: true } });
    agentA = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    agentB = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Bala Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, agentA.id, agentB.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP4-Agents-${randomUUID().slice(0, 6)}`, areaLabel: "Indiranagar", city: "Bengaluru", actualName: "Nest PG", fullAddress: "2 Road", pincode: "560038", latitude: 12.97, longitude: 77.64, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    bookingA1 = await mkBooking(RENT_A1, agentA.id);
    bookingA2 = await mkBooking(RENT_A2, agentA.id);
    await mkBooking(RENT_B1, agentB.id); // agent B's own booking
  });

  afterAll(async () => {
    await prisma.commissionLedger.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { bookingId: { in: bookingIds } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it("per-agent scorecard: submitted / approved / conversion + incentive tier + leaderboard", async () => {
    const r = await getAgents();

    const a = cardFor(r, agentA.id);
    expect(a.submitted).toBe(2);
    expect(a.approved).toBe(2);
    expect(a.conversionRate).toBe(1);
    expect(a.commissionPaise).toBe(COMM_A1 + COMM_A2); // 500,000
    expect(a.tier.name).toBe("Bronze"); // 2 approved → Bronze
    expect(a.tier.nextTierName).toBe("Silver");
    expect(a.tier.bookingsToNextTier).toBe(3); // Silver at 5

    const b = cardFor(r, agentB.id);
    expect(b.approved).toBe(1);
    expect(b.commissionPaise).toBe(COMM_B1); // 100,000

    // Leaderboard ranks by commission earned: A (500k) before B (100k).
    expect(r.leaderboard.map((x) => x.agentId)).toEqual([agentA.id, agentB.id]);
  });

  it("reassigning a booking moves commission + updates BOTH agents + re-ranks the leaderboard", async () => {
    const before = await getAgents();
    expect(cardFor(before, agentA.id).commissionPaise).toBe(COMM_A1 + COMM_A2);
    expect(cardFor(before, agentB.id).commissionPaise).toBe(COMM_B1);

    // Move bookingA2 (commission 200,000) from agent A to agent B.
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/agents/bookings/${bookingA2.id}/reassign`,
      headers: auth(adminToken),
      payload: { agentId: agentB.id },
    });
    expect(res.statusCode).toBe(200);
    const result = (res.json() as { result: ReassignBookingResult }).result;
    expect(result.previousAgentId).toBe(agentA.id);
    expect(result.agentId).toBe(agentB.id);
    expect(result.agentName).toBe("Bala Agent");
    // The commission is recomputed through the engine — now credited to B.
    expect(result.commission).not.toBeNull();
    expect(result.commission!.commissionPaise).toBe(COMM_A2);

    // The attribution actually moved on the row.
    const moved = await prisma.booking.findUnique({ where: { id: bookingA2.id }, select: { bookedByAgentId: true } });
    expect(moved!.bookedByAgentId).toBe(agentB.id);

    // Re-fetch: commission has MOVED from A to B, and performance updated for both.
    const after = await getAgents();
    const a = cardFor(after, agentA.id);
    const b = cardFor(after, agentB.id);

    expect(a.approved).toBe(1); // lost bookingA2
    expect(a.submitted).toBe(1); // and it's no longer A's submission either
    expect(a.commissionPaise).toBe(COMM_A1); // 300,000

    expect(b.approved).toBe(2); // gained bookingA2
    expect(b.submitted).toBe(2);
    expect(b.commissionPaise).toBe(COMM_B1 + COMM_A2); // 300,000

    // Commission is conserved — nothing was created or destroyed, only re-credited.
    expect(a.commissionPaise + b.commissionPaise).toBe(COMM_A1 + COMM_A2 + COMM_B1);

    // Leaderboard re-ranks: A (300k, 1 booking) and B (300k, 2 bookings) tie on
    // commission; the tiebreak (more approved) puts B first.
    expect(after.leaderboard[0]!.agentId).toBe(agentB.id);

    // The correction is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "erp.booking.reassigned", targetId: bookingA2.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { fromAgentId?: string }).fromAgentId).toBe(agentA.id);
    expect((audit!.metadata as { toAgentId?: string }).toAgentId).toBe(agentB.id);
  });

  it("reassigning to a non-agent is rejected (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/agents/bookings/${bookingA1.id}/reassign`,
      headers: auth(adminToken),
      payload: { agentId: tenant.id }, // a TENANT, not an agent
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("AGENT_NOT_FOUND");
  });
});
