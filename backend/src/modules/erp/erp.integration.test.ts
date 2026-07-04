import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { netCommissionPaise, proRataFirstMonthRentPaise } from "./erp.engine.js";
import type { CommissionLedgerEntry, CommissionLedgerResponse } from "@roomadda/shared";

/**
 * ERP money engine + commission ledger (§15) end-to-end against a live Postgres.
 * Proves: the ledger aggregates ONLY confirmed-paid bookings; every figure is
 * integer paise from the one money engine (commission = BPS of rent, collected =
 * captured-online + collected-cash, net = commission + paidToPg − collected);
 * the finance filter (property/agent) scopes correctly; and mark-received (single
 * + bulk) settles + audits. Assumes AGENT_COMMISSION_BPS default = 1000 (10%).
 */
const uniquePhone = () => "+9191" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000; // 10% — the env default the engine reads
const commissionOf = (rentPaise: number) => Math.floor((rentPaise * BPS) / 10_000);

/** Assert every money field on an entry is an integer number of paise. */
function assertIntegerPaise(e: CommissionLedgerEntry): void {
  for (const v of [e.monthlyRentPaise, e.commissionPaise, e.paidToPgPaise, e.collectedPaise, e.netPaise]) {
    expect(Number.isInteger(v)).toBe(true);
  }
}

describe("erp commission ledger (§15, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let agentA: User;
  let agentB: User;
  let host: User;
  let tenant: User;
  let propertyA: PgListing;
  let propertyB: PgListing;
  let adminToken: string;
  let agentToken: string;

  // Confirmed-paid bookings under test.
  let a1: Booking; // agentA / propertyA — split-settled (online + cash) = 500,000
  let a2: Booking; // agentA / propertyA — online-only 500,000
  let b1: Booking; // agentB / propertyB — cash-only 250,000
  let selfServe: Booking; // no agent / propertyA — online 400,000
  let pending: Booking; // agentA / propertyA — TOKEN_PENDING (must be excluded)

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];

  const mkBooking = async (opts: {
    listing: PgListing;
    agentId: string | null;
    channel: "ASSISTED" | "WALK_IN" | null;
    status: "CONFIRMED" | "TOKEN_PENDING";
    rentPaise: number;
    tokenPaise: number;
  }): Promise<Booking> => {
    const room = await prisma.room.create({
      data: { listingId: opts.listing.id, name: `R-${randomUUID().slice(0, 6)}`, sharingType: 2, monthlyRentPaise: opts.rentPaise, depositPaise: 0 },
    });
    const bed = await prisma.bed.create({
      data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: opts.status === "CONFIRMED" ? "BOOKED" : "AVAILABLE" },
    });
    const booking = await prisma.booking.create({
      data: {
        bedId: bed.id,
        tenantId: tenant.id,
        listingId: opts.listing.id,
        status: opts.status,
        tokenAmountPaise: opts.tokenPaise,
        monthlyRentPaise: opts.rentPaise,
        depositPaise: 0,
        bookedByAgentId: opts.agentId,
        agentChannel: opts.channel,
        confirmedAt: opts.status === "CONFIRMED" ? new Date() : null,
      },
    });
    bookingIds.push(booking.id);
    return booking;
  };

  const addCapturedOnline = async (booking: Booking, amountPaise: number): Promise<void> => {
    const payment = await prisma.payment.create({
      data: { bookingId: booking.id, amountPaise, status: "CAPTURED", method: "RAZORPAY", razorpayOrderId: `order_${randomUUID().slice(0, 12)}` },
    });
    await prisma.paymentTransaction.create({
      data: { paymentId: payment.id, amountPaise, status: "CAPTURED", method: "RAZORPAY", razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}`, capturedAt: new Date() },
    });
  };

  const addCash = async (booking: Booking, agentId: string, amountPaise: number): Promise<void> => {
    await prisma.cashCollection.create({
      data: { bookingId: booking.id, agentId, amountPaise, status: "COLLECTED", collectedAt: new Date() },
    });
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP Tenant", role: "TENANT", isPhoneVerified: true } });
    agentA = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Asha", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    agentB = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Bala", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, agentA.id, agentB.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agentA.id, role: "AGENT" });

    const mkListing = async (alias: string): Promise<PgListing> => {
      const l = await prisma.pgListing.create({
        data: { hostId: host.id, alias, areaLabel: "Area", city: "Bengaluru", actualName: "Real Name", fullAddress: "1 Road", pincode: "560001", latitude: 12.9, longitude: 77.6, status: "PUBLISHED" },
      });
      listingIds.push(l.id);
      return l;
    };
    propertyA = await mkListing(`ERP-A-${randomUUID().slice(0, 6)}`);
    propertyB = await mkListing(`ERP-B-${randomUUID().slice(0, 6)}`);

    a1 = await mkBooking({ listing: propertyA, agentId: agentA.id, channel: "ASSISTED", status: "CONFIRMED", rentPaise: 1_000_000, tokenPaise: 500_000 });
    await addCapturedOnline(a1, 300_000);
    await addCash(a1, agentA.id, 200_000); // collected = 500,000

    a2 = await mkBooking({ listing: propertyA, agentId: agentA.id, channel: "WALK_IN", status: "CONFIRMED", rentPaise: 2_000_000, tokenPaise: 500_000 });
    await addCapturedOnline(a2, 500_000); // collected = 500,000

    b1 = await mkBooking({ listing: propertyB, agentId: agentB.id, channel: "WALK_IN", status: "CONFIRMED", rentPaise: 500_000, tokenPaise: 250_000 });
    await addCash(b1, agentB.id, 250_000); // collected = 250,000 (cash only)

    selfServe = await mkBooking({ listing: propertyA, agentId: null, channel: null, status: "CONFIRMED", rentPaise: 800_000, tokenPaise: 400_000 });
    await addCapturedOnline(selfServe, 400_000); // collected = 400,000

    pending = await mkBooking({ listing: propertyA, agentId: agentA.id, channel: "ASSISTED", status: "TOKEN_PENDING", rentPaise: 900_000, tokenPaise: 450_000 });
    await addCapturedOnline(pending, 100_000); // partial; NOT settled → must be excluded
  });

  afterAll(async () => {
    await prisma.commissionLedger.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.cashCollection.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const getLedger = async (qs: string): Promise<CommissionLedgerResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/commission${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as CommissionLedgerResponse;
  };

  it("proves the net formula against the PRD example (4000 + 2000 − 5000 = 1000)", () => {
    expect(netCommissionPaise({ commissionPaise: 4000, paidToPgPaise: 2000, collectedPaise: 5000 })).toBe(1000);
  });

  it("proves pro-rata across month / leap boundaries", () => {
    const RENT = 3_000_000;
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 1)))).toBe(RENT); // full month
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 4)))).toBe(2_709_677); // mid-month, 31d
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2024, 1, 15)))).toBe(1_551_724); // leap Feb
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2023, 1, 15)))).toBe(1_500_000); // non-leap Feb
    expect(proRataFirstMonthRentPaise(RENT, new Date(Date.UTC(2026, 6, 31)))).toBe(96_774); // last day
  });

  it("aggregates ONLY confirmed-paid bookings (agent filter excludes the pending one)", async () => {
    const ledger = await getLedger(`?agentId=${agentA.id}`);
    const ids = ledger.items.map((e) => e.bookingId).sort();
    expect(ids).toEqual([a1.id, a2.id].sort());
    expect(ledger.items.some((e) => e.bookingId === pending.id)).toBe(false);
    ledger.items.forEach(assertIntegerPaise);
  });

  it("prices each booking through the money engine (commission / collected / net)", async () => {
    const ledger = await getLedger(`?listingId=${propertyA.id}`);
    const byId = new Map(ledger.items.map((e) => [e.bookingId, e]));
    expect([...byId.keys()].sort()).toEqual([a1.id, a2.id, selfServe.id].sort());

    const eA1 = byId.get(a1.id)!;
    expect(eA1.commissionPaise).toBe(commissionOf(1_000_000)); // 100,000
    expect(eA1.collectedPaise).toBe(500_000); // 300,000 online + 200,000 cash
    expect(eA1.paidToPgPaise).toBe(0);
    expect(eA1.status).toBe("PENDING");
    expect(eA1.netPaise).toBe(100_000 + 0 - 500_000); // −400,000
    expect(eA1.agentId).toBe(agentA.id);

    const eSelf = byId.get(selfServe.id)!;
    expect(eSelf.agentId).toBeNull();
    expect(eSelf.collectedPaise).toBe(400_000);
    expect(eSelf.netPaise).toBe(commissionOf(800_000) - 400_000);
    ledger.items.forEach(assertIntegerPaise);
  });

  it("marks a single booking's commission received, records paidToPg, and audits it", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/commission/${a1.id}/received`,
      headers: auth(adminToken),
      payload: { paidToPgPaise: 200_000, note: "settled Q2" },
    });
    expect(res.statusCode).toBe(200);
    const { entry } = res.json() as { entry: CommissionLedgerEntry };
    expect(entry.status).toBe("RECEIVED");
    expect(entry.receivedAt).not.toBeNull();
    expect(entry.paidToPgPaise).toBe(200_000);
    expect(entry.netPaise).toBe(100_000 + 200_000 - 500_000); // −200,000

    const audit = await prisma.auditLog.findFirst({
      where: { action: "erp.commission.received", targetId: a1.id, actorId: admin.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { paidToPgPaise?: number }).paidToPgPaise).toBe(200_000);
  });

  it("bulk-marks received, skipping non-confirmed bookings, and audits once", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/commission/received`,
      headers: auth(adminToken),
      payload: { bookingIds: [a2.id, b1.id, pending.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { updated: number; bookingIds: string[] };
    expect(body.updated).toBe(2); // pending skipped
    expect(body.bookingIds.sort()).toEqual([a2.id, b1.id].sort());

    const audit = await prisma.auditLog.findFirst({
      where: { action: "erp.commission.received_bulk", actorId: admin.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { settled?: number }).settled).toBe(2);
  });

  it("filters by settlement status and rolls up consistent totals", async () => {
    const received = await getLedger(`?agentId=${agentA.id}&status=RECEIVED`);
    expect(received.items.map((e) => e.bookingId).sort()).toEqual([a1.id, a2.id].sort());

    const pendingForA = await getLedger(`?agentId=${agentA.id}&status=PENDING`);
    expect(pendingForA.items).toHaveLength(0);

    // Totals over agentA's now-settled bookings: a1 (paidToPg 200k) + a2 (0).
    const { totals } = received;
    expect(totals.bookingCount).toBe(2);
    expect(totals.receivedCount).toBe(2);
    expect(totals.pendingCount).toBe(0);
    expect(totals.commissionPaise).toBe(commissionOf(1_000_000) + commissionOf(2_000_000)); // 300,000
    expect(totals.collectedPaise).toBe(500_000 + 500_000); // 1,000,000
    expect(totals.paidToPgPaise).toBe(200_000);
    expect(totals.netPaise).toBe((100_000 + 200_000 - 500_000) + (200_000 + 0 - 500_000)); // −500,000
    expect(totals.receivedNetPaise).toBe(totals.netPaise);
    // Totals equal the sum of the row figures — no headline can disagree with rows.
    const rowSum = received.items.reduce((s, e) => s + e.netPaise, 0);
    expect(totals.netPaise).toBe(rowSum);
  });

  it("echoes the resolved finance period (defaults to the current FY)", async () => {
    const ledger = await getLedger(`?agentId=${agentA.id}`);
    expect(ledger.period.financialYear).toBeGreaterThanOrEqual(2026);
    expect(new Date(ledger.period.toExclusive).getTime()).toBeGreaterThan(new Date(ledger.period.fromInclusive).getTime());
  });

  it("is ADMIN-only (an agent is denied)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/commission`, headers: auth(agentToken) });
    expect(res.statusCode).toBe(403);
  });
});
