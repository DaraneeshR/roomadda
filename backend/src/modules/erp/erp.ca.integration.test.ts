import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { agentCommissionPaise, netCommissionPaise } from "./erp.engine.js";
import type { ErpDashboardResponse } from "@roomadda/shared";

/**
 * ERP-5 CA & Compliance (§15.3) end-to-end against a live Postgres. Proves: the
 * CA pack is a REAL multi-sheet .xlsx (loads in exceljs, six named sheets); each
 * money sheet's totals reconcile to the §15.3 dashboard for the same FY; the six
 * report exports generate (xlsx + csv); and the FY filter scopes the pack (an empty
 * FY yields zeroes). Every figure is engine-priced. Uses an ISOLATED FY (2029) so
 * the whole-company roll-up is deterministic regardless of other rows. BPS = 1000.
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;
const FY = 2029; // isolated: no other test touches this financial year
const EMPTY_FY = 2030;

const RENT1 = 3_000_000, RENT2 = 2_000_000;
const ONLINE1 = 1_000_000, CASH1 = 500_000, COLLECTED1 = ONLINE1 + CASH1;
const ONLINE2 = 800_000, CASH2 = 200_000, COLLECTED2 = ONLINE2 + CASH2;
const PAID_TO_PG1 = 400_000;
const MAY = new Date(Date.UTC(2029, 4, 15));
const JUN = new Date(Date.UTC(2029, 5, 20));

const COMMISSION1 = agentCommissionPaise(RENT1, BPS);
const COMMISSION2 = agentCommissionPaise(RENT2, BPS);
const NET1 = netCommissionPaise({ commissionPaise: COMMISSION1, paidToPgPaise: PAID_TO_PG1, collectedPaise: COLLECTED1 });
const NET2 = netCommissionPaise({ commissionPaise: COMMISSION2, paidToPgPaise: 0, collectedPaise: COLLECTED2 });

const paiseToRupees = (paise: number) => Math.round(paise) / 100;

describe("erp-5 CA & compliance pack (§15.3, integration)", () => {
  let app: FastifyInstance;
  let admin: User, host: User, tenant1: User, tenant2: User, agent: User;
  let property: PgListing;
  let adminToken: string, agentToken: string;

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
        bedId: bed.id, tenantId: tenant.id, listingId: property.id, status: "CONFIRMED",
        tokenAmountPaise: 1_000_000, monthlyRentPaise: rentPaise, depositPaise: 2_000_000,
        moveInDate: when, createdAt: when, confirmedAt: when,
        bookedByAgentId: agent.id, agentChannel: "ASSISTED",
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

  const loadWorkbook = async (buffer: Buffer): Promise<ExcelJS.Workbook> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  };
  const dashboard = async (fy: number): Promise<ErpDashboardResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/dashboard?financialYear=${fy}`, headers: auth(adminToken) });
    return res.json() as ErpDashboardResponse;
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP5 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya PgOwner", role: "HOST", isPhoneVerified: true } });
    tenant1 = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Ravi Tenant", role: "TENANT", isPhoneVerified: true } });
    tenant2 = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Sona Tenant", role: "TENANT", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant1.id, tenant2.id, agent.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agent.id, role: "AGENT" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP5-Nest-${randomUUID().slice(0, 6)}`, areaLabel: "Indiranagar", city: "Bengaluru", actualName: "Nest PG", fullAddress: "2 Rd", pincode: "560038", latitude: 12.97, longitude: 77.64, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    const b1 = await mkBooking(tenant1, RENT1, MAY);
    await addMoney(b1, ONLINE1, CASH1);
    const b2 = await mkBooking(tenant2, RENT2, JUN);
    await addMoney(b2, ONLINE2, CASH2);
    await prisma.commissionLedger.create({
      data: { bookingId: b1.id, status: "RECEIVED", paidToPgPaise: PAID_TO_PG1, receivedAt: new Date(), receivedById: admin.id },
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

  it("CA pack is a real multi-sheet .xlsx with the six named sheets", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/ca-pack?financialYear=${FY}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("openxmlformats");
    // .xlsx is a zip archive → magic bytes "PK".
    expect(res.rawPayload.subarray(0, 2).toString("utf8")).toBe("PK");

    const wb = await loadWorkbook(res.rawPayload);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      "Bookings Ledger",
      "Commission Ledger",
      "Customer Invoices",
      "Commission Invoices",
      "Collections & Settlements",
      "Summary",
    ]);
  });

  it("each money sheet's totals reconcile to the §15.3 dashboard for the same FY", async () => {
    const dash = await dashboard(FY);
    const res = await app.inject({ method: "GET", url: `/v1/erp/ca-pack?financialYear=${FY}`, headers: auth(adminToken) });
    const wb = await loadWorkbook(res.rawPayload);

    // Directly-computed engine expectations (isolated FY → only our two bookings).
    expect(dash.headline.commissionPaise).toBe(COMMISSION1 + COMMISSION2);
    expect(dash.headline.totalCollectionPaise).toBe(COLLECTED1 + COLLECTED2);
    expect(dash.headline.netCommissionPaise).toBe(NET1 + NET2);

    // Helper: the (bold) totals row is the last row of a sheet.
    const totalsCell = (sheetName: string, col: number): number => {
      const ws = wb.getWorksheet(sheetName)!;
      return Number(ws.getRow(ws.rowCount).getCell(col).value);
    };

    // Commission Ledger: Net (col 8) total == dashboard net commission (rupees).
    expect(totalsCell("Commission Ledger", 8)).toBe(paiseToRupees(dash.headline.netCommissionPaise));
    // Commission Ledger: Commission (col 5) total == dashboard gross commission.
    expect(totalsCell("Commission Ledger", 5)).toBe(paiseToRupees(dash.headline.commissionPaise));
    // Collections & Settlements: Collected (col 4) total == dashboard total collection.
    expect(totalsCell("Collections & Settlements", 4)).toBe(paiseToRupees(dash.headline.totalCollectionPaise));
    // Collections & Settlements: Paid to PG (col 5) total == dashboard paidToPg.
    expect(totalsCell("Collections & Settlements", 5)).toBe(paiseToRupees(dash.headline.paidToPgPaise));
    // Bookings Ledger: Commission (col 8) total == dashboard gross commission.
    expect(totalsCell("Bookings Ledger", 8)).toBe(paiseToRupees(dash.headline.commissionPaise));
    // Customer Invoices: Collected (col 7) total == dashboard total collection.
    expect(totalsCell("Customer Invoices", 7)).toBe(paiseToRupees(dash.headline.totalCollectionPaise));

    // Summary sheet mirrors the dashboard headline (the reconciliation anchor).
    const summary = wb.getWorksheet("Summary")!;
    const metric = (label: string): number => {
      let value = 0;
      summary.eachRow((row) => {
        if (String(row.getCell(1).value) === label) value = Number(row.getCell(2).value);
      });
      return value;
    };
    expect(metric("Net commission")).toBe(paiseToRupees(dash.headline.netCommissionPaise));
    expect(metric("Total collection")).toBe(paiseToRupees(dash.headline.totalCollectionPaise));
    expect(metric("Gross commission")).toBe(paiseToRupees(dash.headline.commissionPaise));
  });

  it("all six report exports generate (xlsx + csv), FY-scoped", async () => {
    const kinds = [
      "bookings-ledger",
      "commission-ledger",
      "customer-invoices",
      "commission-invoices",
      "collections-settlements",
      "summary",
    ];
    for (const kind of kinds) {
      const xlsx = await app.inject({ method: "GET", url: `/v1/erp/reports/${kind}?financialYear=${FY}&format=xlsx`, headers: auth(adminToken) });
      expect(xlsx.statusCode).toBe(200);
      expect(xlsx.headers["content-type"]).toContain("openxmlformats");
      expect(xlsx.rawPayload.subarray(0, 2).toString("utf8")).toBe("PK");

      const csv = await app.inject({ method: "GET", url: `/v1/erp/reports/${kind}?financialYear=${FY}&format=csv`, headers: auth(adminToken) });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body.length).toBeGreaterThan(0);
    }

    // An unknown report kind is a 400 (zod-validated path param).
    const bad = await app.inject({ method: "GET", url: `/v1/erp/reports/not-a-report?financialYear=${FY}`, headers: auth(adminToken) });
    expect(bad.statusCode).toBe(400);
  });

  it("the FY filter scopes the pack (an empty FY yields zeroes)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/ca-pack?financialYear=${EMPTY_FY}`, headers: auth(adminToken) });
    const wb = await loadWorkbook(res.rawPayload);
    // Commission Ledger has only the header + a zero totals row (no data rows).
    const cl = wb.getWorksheet("Commission Ledger")!;
    expect(cl.rowCount).toBe(2); // header + totals
    expect(Number(cl.getRow(2).getCell(8).value)).toBe(0); // net total = 0

    const dash = await dashboard(EMPTY_FY);
    expect(dash.headline.bookingCount).toBe(0);
    expect(dash.headline.netCommissionPaise).toBe(0);
  });

  it("is ADMIN-only (an agent is denied the pack + reports)", async () => {
    for (const url of [`/v1/erp/ca-pack?financialYear=${FY}`, `/v1/erp/reports/summary?financialYear=${FY}`]) {
      const res = await app.inject({ method: "GET", url, headers: auth(agentToken) });
      expect(res.statusCode).toBe(403);
    }
  });
});
