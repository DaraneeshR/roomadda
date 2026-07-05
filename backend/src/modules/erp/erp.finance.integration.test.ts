import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { agentCommissionPaise, netCommissionPaise } from "./erp.engine.js";
import type {
  CommissionLedgerResponse,
  ErpDashboardResponse,
  ErpMoneyManagerResponse,
} from "@roomadda/shared";

/**
 * ERP-4 Dashboard + Money Manager (§15.3) end-to-end against a live Postgres.
 * Proves: the dashboard headline totals EQUAL the engine over the filtered set
 * (== the commission ledger's own totals for the same filter); the money-manager
 * monthly sums reconcile to those totals; and the ONE global filter (FY / month /
 * property) scopes all three surfaces identically. Every figure is engine-priced.
 *
 * The data is scoped to a dedicated property + a fixed FY (2026), so the roll-ups
 * are deterministic regardless of what else is in the DB or the wall-clock date.
 * AGENT_COMMISSION_BPS default = 1000 (10%).
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;
const FY = 2026;

// Two confirmed-paid bookings in FY2026, in different months + for different tenants.
const RENT1 = 3_000_000; // ₹30,000 → commission 300,000
const RENT2 = 2_000_000; // ₹20,000 → commission 200,000
const ONLINE1 = 1_000_000;
const CASH1 = 500_000;
const COLLECTED1 = ONLINE1 + CASH1; // 1,500,000
const ONLINE2 = 800_000;
const CASH2 = 200_000;
const COLLECTED2 = ONLINE2 + CASH2; // 1,000,000
const PAID_TO_PG1 = 400_000; // cust1 settled with a payout to the PG owner
const MAY = new Date(Date.UTC(2026, 4, 15)); // 15 May 2026 → month "2026-05"
const JUN = new Date(Date.UTC(2026, 5, 20)); // 20 Jun 2026 → month "2026-06"

const COMMISSION1 = agentCommissionPaise(RENT1, BPS); // 300,000
const COMMISSION2 = agentCommissionPaise(RENT2, BPS); // 200,000
const NET1 = netCommissionPaise({ commissionPaise: COMMISSION1, paidToPgPaise: PAID_TO_PG1, collectedPaise: COLLECTED1 });
const NET2 = netCommissionPaise({ commissionPaise: COMMISSION2, paidToPgPaise: 0, collectedPaise: COLLECTED2 });

describe("erp-4 dashboard + money manager (§15.3, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let host: User;
  let tenant1: User;
  let tenant2: User;
  let agent: User;
  let property: PgListing;
  let adminToken: string;
  let agentToken: string;
  let cust1: Booking;
  let cust2: Booking;

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];

  const mkBooking = async (tenant: User, rentPaise: number, when: Date): Promise<Booking> => {
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
        tokenAmountPaise: 1_000_000,
        monthlyRentPaise: rentPaise,
        depositPaise: 2_000_000,
        moveInDate: when,
        bookedByAgentId: agent.id,
        agentChannel: "ASSISTED",
        // Both createdAt and confirmedAt land in FY2026 so every §15.3 lens is deterministic.
        createdAt: when,
        confirmedAt: when,
      },
    });
    bookingIds.push(booking.id);
    return booking;
  };

  const addMoney = async (booking: Booking, online: number, cash: number): Promise<void> => {
    const payment = await prisma.payment.create({
      data: { bookingId: booking.id, amountPaise: online, status: "CAPTURED", method: "RAZORPAY", razorpayOrderId: `order_${randomUUID().slice(0, 12)}` },
    });
    await prisma.paymentTransaction.create({
      data: { paymentId: payment.id, amountPaise: online, status: "CAPTURED", method: "RAZORPAY", razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}`, capturedAt: new Date() },
    });
    await prisma.cashCollection.create({
      data: { bookingId: booking.id, agentId: agent.id, amountPaise: cash, status: "COLLECTED", collectedAt: new Date() },
    });
  };

  const getDashboard = async (qs: string): Promise<ErpDashboardResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/dashboard?${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as ErpDashboardResponse;
  };
  const getMoney = async (qs: string): Promise<ErpMoneyManagerResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/money-manager?${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as ErpMoneyManagerResponse;
  };
  const getLedger = async (qs: string): Promise<CommissionLedgerResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/commission?${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as CommissionLedgerResponse;
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP4 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya PgOwner", role: "HOST", isPhoneVerified: true } });
    tenant1 = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Ravi Tenant", role: "TENANT", isPhoneVerified: true } });
    tenant2 = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Sona Tenant", role: "TENANT", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant1.id, tenant2.id, agent.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agent.id, role: "AGENT" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP4-Nest-${randomUUID().slice(0, 6)}`, areaLabel: "Indiranagar", city: "Bengaluru", actualName: "Nest PG", fullAddress: "2 Road", pincode: "560038", latitude: 12.97, longitude: 77.64, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    cust1 = await mkBooking(tenant1, RENT1, MAY);
    await addMoney(cust1, ONLINE1, CASH1);
    cust2 = await mkBooking(tenant2, RENT2, JUN);
    await addMoney(cust2, ONLINE2, CASH2);

    // Settle cust1 with a payout to the PG owner (the ERP-owned settlement state).
    await prisma.commissionLedger.create({
      data: { bookingId: cust1.id, status: "RECEIVED", paidToPgPaise: PAID_TO_PG1, receivedAt: new Date(), receivedById: admin.id },
    });
  });

  afterAll(async () => {
    await prisma.commissionLedger.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.cashCollection.deleteMany({ where: { bookingId: { in: bookingIds } } });
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

  it("dashboard headline == the engine over the filtered set (== commission-ledger totals)", async () => {
    const scope = `financialYear=${FY}&listingId=${property.id}`;
    const dash = await getDashboard(scope);
    const ledger = await getLedger(scope);

    // Directly-computed engine expectations.
    expect(dash.headline.bookingCount).toBe(2);
    expect(dash.headline.commissionPaise).toBe(COMMISSION1 + COMMISSION2); // 500,000
    expect(dash.headline.totalCollectionPaise).toBe(COLLECTED1 + COLLECTED2); // 2,500,000
    expect(dash.headline.paidToPgPaise).toBe(PAID_TO_PG1); // 400,000
    expect(dash.headline.netCommissionPaise).toBe(NET1 + NET2);
    expect(dash.headline.receivedNetPaise).toBe(NET1); // cust1 settled
    expect(dash.headline.pendingNetPaise).toBe(NET2); // cust2 pending
    expect(dash.headline.receivedBookingCount).toBe(1);
    expect(dash.headline.pendingBookingCount).toBe(1);

    // …and it agrees with the commission ledger's own totals for the same filter.
    expect(dash.headline.netCommissionPaise).toBe(ledger.totals.netPaise);
    expect(dash.headline.commissionPaise).toBe(ledger.totals.commissionPaise);
    expect(dash.headline.totalCollectionPaise).toBe(ledger.totals.collectedPaise);
    expect(dash.headline.paidToPgPaise).toBe(ledger.totals.paidToPgPaise);
    expect(dash.headline.pendingNetPaise).toBe(ledger.totals.pendingNetPaise);
    expect(dash.headline.receivedNetPaise).toBe(ledger.totals.receivedNetPaise);

    // AMC is the flagged gap — never fabricated.
    expect(dash.headline.amc.supported).toBe(false);
    expect(dash.headline.amc.paise).toBeNull();
    expect(dash.period.financialYear).toBe(FY);
  });

  it("dashboard charts: commission-by-property + zero-filled bookings-by-month + top agent", async () => {
    const dash = await getDashboard(`financialYear=${FY}&listingId=${property.id}`);

    expect(dash.commissionByProperty).toHaveLength(1);
    expect(dash.commissionByProperty[0]!.listingId).toBe(property.id);
    expect(dash.commissionByProperty[0]!.commissionPaise).toBe(COMMISSION1 + COMMISSION2);
    expect(dash.commissionByProperty[0]!.bookingCount).toBe(2);

    // A whole FY spans 12 months, all present; only May + June carry data.
    expect(dash.bookingsByMonth).toHaveLength(12);
    const may = dash.bookingsByMonth.find((m) => m.month === "2026-05")!;
    const jun = dash.bookingsByMonth.find((m) => m.month === "2026-06")!;
    expect(may.bookingCount).toBe(1);
    expect(may.commissionPaise).toBe(COMMISSION1);
    expect(jun.bookingCount).toBe(1);
    expect(jun.commissionPaise).toBe(COMMISSION2);
    expect(dash.bookingsByMonth.reduce((s, m) => s + m.bookingCount, 0)).toBe(2);

    expect(dash.topAgents).toHaveLength(1);
    expect(dash.topAgents[0]!.agentId).toBe(agent.id);
    expect(dash.topAgents[0]!.commissionPaise).toBe(COMMISSION1 + COMMISSION2);
  });

  it("money-manager: month-by-month + running balance + customer drill-down reconcile to the ledger", async () => {
    const scope = `financialYear=${FY}&listingId=${property.id}`;
    const money = await getMoney(scope);
    const ledger = await getLedger(scope);

    expect(money.months).toHaveLength(12);
    const may = money.months.find((m) => m.month === "2026-05")!;
    const jun = money.months.find((m) => m.month === "2026-06")!;

    expect(may.collectionPaise).toBe(COLLECTED1);
    expect(may.commissionPaise).toBe(COMMISSION1);
    expect(may.payoutPaise).toBe(PAID_TO_PG1);
    expect(may.netPaise).toBe(NET1);
    expect(may.settledNetPaise).toBe(NET1); // cust1 RECEIVED
    expect(may.pendingNetPaise).toBe(0);

    expect(jun.collectionPaise).toBe(COLLECTED2);
    expect(jun.commissionPaise).toBe(COMMISSION2);
    expect(jun.payoutPaise).toBe(0);
    expect(jun.settledNetPaise).toBe(0);
    expect(jun.pendingNetPaise).toBe(NET2); // cust2 PENDING

    // Running balance is cumulative net and monotone through the period end.
    expect(may.runningBalancePaise).toBe(NET1);
    expect(jun.runningBalancePaise).toBe(NET1 + NET2);
    expect(money.months[money.months.length - 1]!.runningBalancePaise).toBe(NET1 + NET2);

    // Totals reconcile to the ledger (money-manager monthly sums == the ledger).
    expect(money.totals.collectionPaise).toBe(ledger.totals.collectedPaise);
    expect(money.totals.commissionPaise).toBe(ledger.totals.commissionPaise);
    expect(money.totals.netPaise).toBe(ledger.totals.netPaise);
    expect(money.totals.payoutPaise).toBe(ledger.totals.paidToPgPaise);
    expect(money.totals.settledNetPaise).toBe(ledger.totals.receivedNetPaise);
    expect(money.totals.pendingNetPaise).toBe(ledger.totals.pendingNetPaise);
    // Σ of the per-month rows equals the totals.
    expect(money.months.reduce((s, m) => s + m.netPaise, 0)).toBe(money.totals.netPaise);

    // Customer drill-down: who paid what (sorted by collection desc).
    expect(money.customers).toHaveLength(2);
    expect(money.customers[0]!.tenantId).toBe(tenant1.id); // paid more
    expect(money.customers[0]!.collectionPaise).toBe(COLLECTED1);
    expect(money.customers[0]!.commissionPaise).toBe(COMMISSION1);
    const c2 = money.customers.find((c) => c.tenantId === tenant2.id)!;
    expect(c2.collectionPaise).toBe(COLLECTED2);
  });

  it("the ONE global filter (month=5) scopes dashboard, money-manager and ledger identically", async () => {
    const scope = `financialYear=${FY}&month=5&listingId=${property.id}`;
    const dash = await getDashboard(scope);
    const money = await getMoney(scope);
    const ledger = await getLedger(scope);

    // Only cust1 (May) is in scope across all three.
    expect(dash.headline.bookingCount).toBe(1);
    expect(dash.headline.commissionPaise).toBe(COMMISSION1);
    expect(dash.headline.netCommissionPaise).toBe(NET1);

    expect(money.months).toHaveLength(1); // a single-month filter → one row
    expect(money.months[0]!.month).toBe("2026-05");
    expect(money.totals.commissionPaise).toBe(COMMISSION1);
    expect(money.customers).toHaveLength(1);
    expect(money.customers[0]!.tenantId).toBe(tenant1.id);

    // All three agree with each other for the same filter.
    expect(dash.headline.netCommissionPaise).toBe(ledger.totals.netPaise);
    expect(money.totals.netPaise).toBe(ledger.totals.netPaise);
    expect(dash.headline.commissionPaise).toBe(ledger.totals.commissionPaise);
  });

  it("is ADMIN-only (an agent is denied on every ERP-4 surface)", async () => {
    for (const url of ["/v1/erp/dashboard", "/v1/erp/money-manager", "/v1/erp/agents"]) {
      const res = await app.inject({ method: "GET", url, headers: auth(agentToken) });
      expect(res.statusCode).toBe(403);
    }
  });
});
