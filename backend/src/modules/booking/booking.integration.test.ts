import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { bookingService } from "./booking.service.js";
import { paymentService } from "./payment.service.js";
import { webhookService } from "./webhook.service.js";
import { cashService } from "./cash.service.js";

/** Build a payment.captured webhook (raw body + valid signature). */
function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("booking + token payment (integration)", () => {
  let host: User;
  let tenant: User;
  let agent: User;
  let admin: User;
  let listing: PgListing;
  let room: Room;

  beforeAll(async () => {
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant", role: "TENANT", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent", role: "AGENT", isPhoneVerified: true } });
    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "ITest PG", areaLabel: "Area", city: "City",
        actualName: "ITest Real Name", fullAddress: "1 Test Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
  });

  afterAll(async () => {
    await prisma.cashCollection.deleteMany({ where: { agentId: agent.id } });
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
    await prisma.room.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_itest_" } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, agent.id, admin.id] } } });
    await prisma.$disconnect();
  });

  const freshBed = (label: string) =>
    prisma.bed.create({ data: { roomId: room.id, label: `${label}-${randomUUID().slice(0, 8)}`, status: "AVAILABLE" } });

  it("two simultaneous holds on one bed -> exactly one succeeds", async () => {
    const bed = await freshBed("CONC");
    const results = await Promise.allSettled([
      bookingService.createBookingHold(tenant.id, { bedId: bed.id }),
      bookingService.createBookingHold(tenant.id, { bedId: bed.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const live = await prisma.booking.count({
      where: { bedId: bed.id, status: { in: ["INITIATED", "TOKEN_PENDING", "CONFIRMED"] } },
    });
    expect(live).toBe(1);
    const fresh = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(fresh?.status).toBe("HELD");
  });

  it("the partial unique index rejects a forced second live booking", async () => {
    const bed = await freshBed("FORCE");
    await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    // Bypass the service entirely and force a second live booking on the bed.
    await expect(
      prisma.booking.create({
        data: {
          bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "TOKEN_PENDING",
          tokenAmountPaise: 1, monthlyRentPaise: 1, depositPaise: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("replaying a captured webhook does not double-confirm", async () => {
    const bed = await freshBed("IDEM");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    const pay = await paymentService.createTokenPayment(booking.id, tenant.id, {
      method: "ONLINE", onlinePaise: booking.tokenAmountPaise, cashPaise: 0,
    });
    const orderId = pay.razorpayOrder?.orderId ?? "";
    const { raw, signature } = capturedEvent(orderId, booking.tokenAmountPaise);
    const eventId = `evt_itest_idem_${randomUUID()}`;

    const first = await webhookService.processRazorpay(raw, signature, eventId);
    const second = await webhookService.processRazorpay(raw, signature, eventId);

    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");

    const confirmed = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(confirmed?.status).toBe("CONFIRMED");
    const capturedCount = await prisma.paymentTransaction.count({
      where: { payment: { bookingId: booking.id }, status: "CAPTURED" },
    });
    expect(capturedCount).toBe(1);
    const fresh = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(fresh?.status).toBe("BOOKED");
  });

  it("split payment confirms only after BOTH legs settle", async () => {
    const bed = await freshBed("SPLIT");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    const token = booking.tokenAmountPaise;
    const onlinePaise = Math.floor(token / 2);
    const cashPaise = token - onlinePaise;

    const pay = await paymentService.createTokenPayment(booking.id, tenant.id, {
      method: "SPLIT", onlinePaise, cashPaise, agentId: agent.id,
    });

    // Online leg captured — NOT enough on its own.
    const { raw, signature } = capturedEvent(pay.razorpayOrder?.orderId ?? "", onlinePaise);
    await webhookService.processRazorpay(raw, signature, `evt_itest_split_${randomUUID()}`);
    let current = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(current?.status).toBe("TOKEN_PENDING");

    // Cash leg collected -> now settled -> confirmed.
    const settlement = await cashService.markCollected({ id: agent.id, role: "AGENT" }, pay.cashCollectionId ?? "");
    expect(settlement.confirmed).toBe(true);
    current = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(current?.status).toBe("CONFIRMED");
  });

  it("cash reconciliation moves COLLECTED -> RECONCILED and is auditable", async () => {
    const bed = await freshBed("RECON");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    const pay = await paymentService.createTokenPayment(booking.id, tenant.id, {
      method: "CASH", onlinePaise: 0, cashPaise: booking.tokenAmountPaise, agentId: agent.id,
    });
    const cashId = pay.cashCollectionId ?? "";

    // Agent collects full cash -> booking confirms.
    await cashService.markCollected({ id: agent.id, role: "AGENT" }, cashId);
    const afterCollect = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(afterCollect?.status).toBe("CONFIRMED");

    // Admin reconciles.
    await cashService.markReconciled({ id: admin.id, role: "ADMIN" }, cashId);
    const cc = await prisma.cashCollection.findUnique({ where: { id: cashId } });
    expect(cc?.status).toBe("RECONCILED");

    // Auditable.
    const audit = await prisma.auditLog.findFirst({ where: { action: "cash.reconciled", targetId: booking.id } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(admin.id);
  });

  it("expireStaleHolds frees a bed whose hold has lapsed", async () => {
    const bed = await freshBed("EXP");
    const booking = await bookingService.createBookingHold(tenant.id, { bedId: bed.id });
    // Force the hold into the past.
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    const freed = await bookingService.expireStaleHolds();
    expect(freed).toBeGreaterThanOrEqual(1);

    const expired = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(expired?.status).toBe("EXPIRED");
    const fresh = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(fresh?.status).toBe("AVAILABLE");
  });
});
