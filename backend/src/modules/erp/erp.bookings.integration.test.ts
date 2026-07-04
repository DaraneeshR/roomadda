import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Booking, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { erpRoutes } from "./erp.route.js";
import { agentService } from "../agent/agent.service.js";
import type {
  BookingApprovalsResponse,
  BookingLedgerResponse,
  CommissionLedgerResponse,
  ErpBookingDetailResponse,
} from "@roomadda/shared";

/**
 * ERP-2 bookings ledger, approvals, and booking/KYC detail (§15.3) end-to-end
 * against a live Postgres. Proves: the ledger totals equal the money engine's; a
 * historical booking flows into the commission ledger + agent performance exactly
 * like a live one; approve/reject/bulk are audited; and KYC docs are reachable
 * ONLY through a short-lived signed URL (never the raw key). AGENT_COMMISSION_BPS
 * default = 1000 (10%).
 */
const uniquePhone = () => "+9192" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const BPS = 1000;
const commissionOf = (rentPaise: number) => Math.floor((rentPaise * BPS) / 10_000);

describe("erp-2 bookings ledger / approvals / detail (§15.3, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let host: User;
  let tenant: User;
  let agentA: User; // current-FY confirmed bookings (the "totals equal engine" agent)
  let agentH: User; // the historical booking's agent
  let property: PgListing;
  let adminToken: string;
  let agentToken: string;

  // agentA confirmed-paid bookings (current FY).
  let a1: Booking; // rent 1,000,000 — online 300k + cash 200k = collected 500k
  let a2: Booking; // rent 2,000,000 — online 500k
  let pendingApproval: Booking; // PENDING_APPROVAL (approvals queue + reject target)
  let pendingApproval2: Booking; // PENDING_APPROVAL (approve target)
  let bulk1: Booking; // PENDING_APPROVAL (bulk approve)
  let bulk2: Booking; // PENDING_APPROVAL (bulk approve)
  let rejectedByHost: Booking; // CANCELLED by HOST → approval REJECTED
  let cancelledByTenant: Booking; // CANCELLED by TENANT → approval CANCELLED
  let kycTenant: User; // tenant with a KYC record, for the detail test
  let kycBooking: Booking;

  const userIds: string[] = [];
  const listingIds: string[] = [];
  const bookingIds: string[] = [];
  const bedIds: string[] = [];

  const mkBedRoom = async (rentPaise: number, bedStatus: "AVAILABLE" | "HELD" | "BOOKED") => {
    const room = await prisma.room.create({
      data: { listingId: property.id, name: `R-${randomUUID().slice(0, 6)}`, sharingType: 2, monthlyRentPaise: rentPaise, depositPaise: 0 },
    });
    const bed = await prisma.bed.create({
      data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: bedStatus },
    });
    bedIds.push(bed.id);
    return bed;
  };

  const mkBooking = async (opts: {
    tenantId?: string;
    agentId: string | null;
    channel: "ASSISTED" | "WALK_IN" | null;
    status: Booking["status"];
    rentPaise: number;
    tokenPaise: number;
    confirmedAt?: Date | null;
    cancelledBy?: "TENANT" | "HOST" | "SYSTEM" | null;
    bedStatus?: "AVAILABLE" | "HELD" | "BOOKED";
  }): Promise<Booking> => {
    const bed = await mkBedRoom(opts.rentPaise, opts.bedStatus ?? (opts.status === "CONFIRMED" ? "BOOKED" : "HELD"));
    const booking = await prisma.booking.create({
      data: {
        bedId: bed.id,
        tenantId: opts.tenantId ?? tenant.id,
        listingId: property.id,
        status: opts.status,
        tokenAmountPaise: opts.tokenPaise,
        monthlyRentPaise: opts.rentPaise,
        depositPaise: 0,
        bookedByAgentId: opts.agentId,
        agentChannel: opts.channel,
        confirmedAt: opts.confirmedAt ?? (opts.status === "CONFIRMED" ? new Date() : null),
        ...(opts.cancelledBy ? { cancelledBy: opts.cancelledBy, cancelledAt: new Date() } : {}),
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

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP2 Admin", role: "ADMIN", isPhoneVerified: true } });
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP2 Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP2 Tenant", role: "TENANT", isPhoneVerified: true } });
    kycTenant = await prisma.user.create({
      data: {
        phone: uniquePhone(),
        fullName: "Zephyr KycTenant",
        role: "TENANT",
        isPhoneVerified: true,
        gender: "FEMALE",
        occupationType: "STUDENT",
        college: "IISc",
      },
    });
    agentA = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Asha", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    agentH = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent Hari", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    userIds.push(admin.id, host.id, tenant.id, kycTenant.id, agentA.id, agentH.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agentA.id, role: "AGENT" });

    property = await prisma.pgListing.create({
      data: { hostId: host.id, alias: `ERP2-Green-${randomUUID().slice(0, 6)}`, areaLabel: "Koramangala", city: "Bengaluru", actualName: "Green Nest PG", fullAddress: "1 Road", pincode: "560001", latitude: 12.9, longitude: 77.6, status: "PUBLISHED" },
    });
    listingIds.push(property.id);

    // agentA — confirmed-paid this FY.
    a1 = await mkBooking({ agentId: agentA.id, channel: "ASSISTED", status: "CONFIRMED", rentPaise: 1_000_000, tokenPaise: 500_000 });
    await addCapturedOnline(a1, 300_000);
    await addCash(a1, agentA.id, 200_000); // collected 500,000

    a2 = await mkBooking({ agentId: agentA.id, channel: "WALK_IN", status: "CONFIRMED", rentPaise: 2_000_000, tokenPaise: 500_000 });
    await addCapturedOnline(a2, 500_000); // collected 500,000

    // Approvals queue candidates (PENDING_APPROVAL).
    pendingApproval = await mkBooking({ agentId: null, channel: null, status: "PENDING_APPROVAL", rentPaise: 700_000, tokenPaise: 300_000 });
    pendingApproval2 = await mkBooking({ agentId: null, channel: null, status: "PENDING_APPROVAL", rentPaise: 700_000, tokenPaise: 300_000 });
    bulk1 = await mkBooking({ agentId: null, channel: null, status: "PENDING_APPROVAL", rentPaise: 700_000, tokenPaise: 300_000 });
    bulk2 = await mkBooking({ agentId: null, channel: null, status: "PENDING_APPROVAL", rentPaise: 700_000, tokenPaise: 300_000 });

    // Rejected/cancelled bookings for the approval-mapping assertions.
    rejectedByHost = await mkBooking({ agentId: null, channel: null, status: "CANCELLED", rentPaise: 700_000, tokenPaise: 300_000, cancelledBy: "HOST", bedStatus: "AVAILABLE" });
    cancelledByTenant = await mkBooking({ agentId: null, channel: null, status: "CANCELLED", rentPaise: 700_000, tokenPaise: 300_000, cancelledBy: "TENANT", bedStatus: "AVAILABLE" });

    // A confirmed booking whose customer has KYC on file (for the detail test).
    kycBooking = await mkBooking({ tenantId: kycTenant.id, agentId: agentA.id, channel: "ASSISTED", status: "CONFIRMED", rentPaise: 1_200_000, tokenPaise: 400_000 });
    await addCapturedOnline(kycBooking, 400_000);
    await prisma.kycRecord.create({
      data: {
        userId: kycTenant.id,
        status: "VERIFIED",
        docType: "AADHAAR",
        aadhaarFrontKey: `kyc/${kycTenant.id}/aadhaar-front-${randomUUID()}.jpg`,
        aadhaarBackKey: `kyc/${kycTenant.id}/aadhaar-back-${randomUUID()}.jpg`,
        supportingDocKey: `kyc/${kycTenant.id}/supporting-${randomUUID()}.pdf`,
        supportingDocType: "STUDENT_ID",
        verifiedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.kycRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.commissionLedger.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.cashCollection.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { bookingId: { in: bookingIds } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    // Historical bookings created via the route link to fresh tenants — clean those too.
    await prisma.booking.deleteMany({ where: { bookedByAgentId: agentH.id } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { fullName: "Historical Customer", role: "TENANT" } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const getLedger = async (qs: string): Promise<BookingLedgerResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/bookings${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as BookingLedgerResponse;
  };
  const getCommission = async (qs: string): Promise<CommissionLedgerResponse> => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/commission${qs}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as CommissionLedgerResponse;
  };

  it("lists every booking with the approval column derived from the real lifecycle", async () => {
    const ledger = await getLedger(`?limit=50`);
    const byId = new Map(ledger.items.map((e) => [e.bookingId, e]));
    expect(byId.get(a1.id)!.approval).toBe("APPROVED");
    expect(byId.get(pendingApproval.id)!.approval).toBe("PENDING");
    expect(byId.get(rejectedByHost.id)!.approval).toBe("REJECTED");
    expect(byId.get(cancelledByTenant.id)!.approval).toBe("CANCELLED");
    // A confirmed booking carries engine commission; a pending one carries none.
    expect(byId.get(a1.id)!.commission!.commissionPaise).toBe(commissionOf(1_000_000));
    expect(byId.get(pendingApproval.id)!.commission).toBeNull();
  });

  it("filters by approval and searches by tenant / listing alias", async () => {
    const pending = await getLedger(`?approval=PENDING&limit=50`);
    expect(pending.items.every((e) => e.approval === "PENDING")).toBe(true);
    expect(pending.items.some((e) => e.bookingId === pendingApproval.id)).toBe(true);

    const search = await getLedger(`?q=Zephyr&limit=50`);
    expect(search.items.some((e) => e.bookingId === kycBooking.id)).toBe(true);
    expect(search.items.every((e) => e.tenantName.includes("Zephyr") || e.listingAlias.includes("Zephyr"))).toBe(true);
  });

  it("ledger commission totals EQUAL the money engine's (bookings ledger == commission ledger)", async () => {
    const ledger = await getLedger(`?agentId=${agentA.id}&limit=50`);
    const commission = await getCommission(`?agentId=${agentA.id}`);

    // Both cover the same confirmed-paid set for agentA (a1 + a2 + kycBooking).
    expect(ledger.totals.commissionedBookingCount).toBe(commission.totals.bookingCount);
    expect(ledger.totals.commissionPaise).toBe(commission.totals.commissionPaise);
    expect(ledger.totals.collectedPaise).toBe(commission.totals.collectedPaise);
    expect(ledger.totals.paidToPgPaise).toBe(commission.totals.paidToPgPaise);
    expect(ledger.totals.netPaise).toBe(commission.totals.netPaise);

    // And the totals equal Σ of the per-row engine figures (no headline can drift).
    const rowSum = ledger.items.reduce((s, e) => s + (e.commission?.netPaise ?? 0), 0);
    expect(ledger.totals.netPaise).toBe(rowSum);
  });

  it("a HISTORICAL booking flows into the commission ledger AND agent performance", async () => {
    const moveIn = new Date(Date.UTC(2025, 4, 15)); // 15 May 2025 → FY2025
    const bed = await mkBedRoom(1_500_000, "AVAILABLE");
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/bookings`,
      headers: auth(adminToken),
      payload: {
        bedId: bed.id,
        tenantName: "Historical Customer",
        tenantPhone: uniquePhone(),
        agentId: agentH.id,
        agentChannel: "WALK_IN",
        moveInDate: moveIn.toISOString(),
        monthlyRentPaise: 1_500_000,
        tokenAmountPaise: 600_000,
      },
    });
    expect(res.statusCode).toBe(201);
    const { entry } = res.json() as { entry: BookingLedgerResponse["items"][number] };
    bookingIds.push(entry.bookingId);
    expect(entry.approval).toBe("APPROVED");
    expect(entry.historical).toBe(true);
    expect(entry.commission!.commissionPaise).toBe(commissionOf(1_500_000)); // 150,000

    // Commission ledger for FY2025 includes it, priced by the engine.
    const commission = await getCommission(`?agentId=${agentH.id}&financialYear=2025`);
    const inLedger = commission.items.find((e) => e.bookingId === entry.bookingId);
    expect(inLedger).toBeDefined();
    expect(inLedger!.commissionPaise).toBe(commissionOf(1_500_000));

    // Agent performance for May 2025 counts it exactly like a live booking.
    const perf = await agentService.performance(agentH.id, "Bengaluru", new Date(Date.UTC(2025, 4, 20)));
    expect(perf.bookingsClosed).toBeGreaterThanOrEqual(1);
    expect(perf.walkInClosed).toBeGreaterThanOrEqual(1);
    expect(perf.commissionEarnedPaise).toBe(commissionOf(1_500_000));
  });

  it("rejects a historical booking with a future move-in date", async () => {
    const bed = await mkBedRoom(1_000_000, "AVAILABLE");
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/bookings`,
      headers: auth(adminToken),
      payload: {
        bedId: bed.id,
        tenantName: "Future Customer",
        tenantPhone: uniquePhone(),
        agentId: agentH.id,
        moveInDate: new Date(Date.now() + 86_400_000).toISOString(),
        monthlyRentPaise: 1_000_000,
        tokenAmountPaise: 400_000,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("MOVE_IN_NOT_PAST");
  });

  it("opens the booking / KYC detail: invoice + net commission from the engine, docs as signed URLs", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/bookings/${kycBooking.id}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as ErpBookingDetailResponse;

    // Customer + admin-visible real listing name.
    expect(detail.customer.fullName).toBe("Zephyr KycTenant");
    expect(detail.listing.actualName).toBe("Green Nest PG");

    // Invoice + net commission from the money engine.
    expect(detail.invoice.monthlyRentPaise).toBe(1_200_000);
    expect(detail.commission!.commissionPaise).toBe(commissionOf(1_200_000));
    expect(detail.commission!.collectedPaise).toBe(400_000);

    // KYC docs: three short-lived signed GET URLs — never the raw object key.
    expect(detail.kyc!.status).toBe("VERIFIED");
    expect(detail.kyc!.documents).toHaveLength(3);
    for (const doc of detail.kyc!.documents) {
      expect(doc.url).toContain("download=1"); // the presigned GET, not a raw key
      expect(doc.expiresInSeconds).toBeGreaterThan(0);
      expect(doc.expiresInSeconds).toBeLessThanOrEqual(3600); // short-lived
    }
    // The raw S3 key column names never leak into the payload.
    const raw = JSON.stringify(detail);
    expect(raw).not.toContain("aadhaarFrontKey");
    expect(raw).not.toContain("supportingDocKey");

    // The document access is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "erp.kyc.viewed", targetId: kycBooking.id, actorId: admin.id },
    });
    expect(audit).not.toBeNull();
  });

  it("approvals queue lists pending bookings; approve moves to TOKEN_PENDING (audited)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/erp/approvals?limit=50`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const queue = res.json() as BookingApprovalsResponse;
    expect(queue.items.every((e) => e.approval === "PENDING")).toBe(true);
    expect(queue.items.some((e) => e.bookingId === pendingApproval2.id)).toBe(true);

    const approve = await app.inject({
      method: "POST",
      url: `/v1/erp/approvals/${pendingApproval2.id}/approve`,
      headers: auth(adminToken),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().decision.approval).toBe("APPROVED");
    const after = await prisma.booking.findUnique({ where: { id: pendingApproval2.id }, select: { status: true } });
    expect(after!.status).toBe("TOKEN_PENDING");
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.booking.approved", targetId: pendingApproval2.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a pending booking → CANCELLED + bed freed (audited)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/approvals/${pendingApproval.id}/reject`,
      headers: auth(adminToken),
      payload: { reason: "duplicate request" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision.approval).toBe("REJECTED");
    const b = await prisma.booking.findUnique({ where: { id: pendingApproval.id }, select: { status: true, cancelledBy: true, bedId: true } });
    expect(b!.status).toBe("CANCELLED");
    expect(b!.cancelledBy).toBe("HOST");
    const bed = await prisma.bed.findUnique({ where: { id: b!.bedId }, select: { status: true } });
    expect(bed!.status).toBe("AVAILABLE");
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.booking.rejected", targetId: pendingApproval.id } });
    expect(audit).not.toBeNull();
  });

  it("bulk-approves several pending bookings, skipping ineligible ones, audited once", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/erp/approvals/approve`,
      headers: auth(adminToken),
      payload: { bookingIds: [bulk1.id, bulk2.id, a1.id] }, // a1 is CONFIRMED → skipped
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { updated: number; bookingIds: string[] };
    expect(body.updated).toBe(2);
    expect(body.bookingIds.sort()).toEqual([bulk1.id, bulk2.id].sort());
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.booking.approved_bulk", actorId: admin.id } });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { approved?: number }).approved).toBe(2);
  });

  it("edits a booking's safe fields (audited) and re-prices commission", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/erp/bookings/${a2.id}`,
      headers: auth(adminToken),
      payload: { monthlyRentPaise: 2_400_000 },
    });
    expect(res.statusCode).toBe(200);
    const { entry } = res.json() as { entry: BookingLedgerResponse["items"][number] };
    expect(entry.monthlyRentPaise).toBe(2_400_000);
    expect(entry.commission!.commissionPaise).toBe(commissionOf(2_400_000)); // re-derived
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.booking.updated", targetId: a2.id } });
    expect(audit).not.toBeNull();
  });

  it("refuses to delete a booking that has money attached, allows a clean one", async () => {
    // a1 has payments/cash → cannot delete.
    const blocked = await app.inject({ method: "DELETE", url: `/v1/erp/bookings/${a1.id}`, headers: auth(adminToken) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("BOOKING_HAS_PAYMENTS");

    // cancelledByTenant has no money → deletable + audited + bed freed.
    const bedId = cancelledByTenant.bedId;
    const ok = await app.inject({ method: "DELETE", url: `/v1/erp/bookings/${cancelledByTenant.id}`, headers: auth(adminToken) });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.booking.findUnique({ where: { id: cancelledByTenant.id } })).toBeNull();
    const bed = await prisma.bed.findUnique({ where: { id: bedId }, select: { status: true } });
    expect(bed!.status).toBe("AVAILABLE");
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.booking.deleted", targetId: cancelledByTenant.id } });
    expect(audit).not.toBeNull();
  });

  it("exports the ledger to CSV and to Excel with the right content types", async () => {
    const csv = await app.inject({ method: "GET", url: `/v1/erp/bookings/export?format=csv&agentId=${agentA.id}`, headers: auth(adminToken) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(".csv");
    expect(csv.body).toContain("Booking ID");

    const xls = await app.inject({ method: "GET", url: `/v1/erp/bookings/export?format=xlsx&agentId=${agentA.id}`, headers: auth(adminToken) });
    expect(xls.statusCode).toBe(200);
    expect(xls.headers["content-type"]).toContain("application/vnd.ms-excel");
    expect(xls.body).toContain('progid="Excel.Sheet"');
  });

  it("is ADMIN-only across the ERP-2 surface (an agent is denied)", async () => {
    for (const url of ["/v1/erp/bookings", "/v1/erp/approvals", `/v1/erp/bookings/${a1.id}`]) {
      const res = await app.inject({ method: "GET", url, headers: auth(agentToken) });
      expect(res.statusCode).toBe(403);
    }
  });
});
