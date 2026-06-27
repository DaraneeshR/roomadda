import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bed, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { adminService } from "../admin/admin.service.js";
import { bookingRoutes } from "../booking/booking.route.js";
import { kycRoutes } from "./kyc.route.js";

/**
 * Closes the just-in-time KYC loop end to end against a live DB: a tenant
 * submits KYC (PENDING), the booking gate stays CLOSED (403 KYC_REQUIRED), an
 * admin verifies, and only THEN does booking + token payment go through. Plus
 * the rejection path: reason is surfaced and a re-upload returns to PENDING.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

/** A valid submit payload with all keys under the user's own prefix. */
function docsFor(userId: string) {
  return {
    aadhaarFront: { key: `kyc/${userId}/aadhaar_front-${randomUUID()}.jpg`, contentType: "image/jpeg" },
    aadhaarBack: { key: `kyc/${userId}/aadhaar_back-${randomUUID()}.jpg`, contentType: "image/jpeg" },
    supporting: {
      key: `kyc/${userId}/supporting-${randomUUID()}.pdf`,
      contentType: "application/pdf",
      docType: "STUDENT_ID",
    },
  };
}

describe("KYC intake -> admin verify -> booking unblock (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User; // happy path: submit -> verify -> book + pay
  let rejectTenant: User; // reject -> reason -> re-upload
  let listing: PgListing;
  let room: Room;
  let bed: Bed;
  let tenantToken: string;
  let rejectToken: string;
  const admin = { id: randomUUID() };

  async function authedInject(
    method: "GET" | "POST",
    url: string,
    token: string,
    payload?: unknown,
  ) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(kycRoutes, { prefix: "/v1" });
    await app.register(bookingRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant", role: "TENANT", isPhoneVerified: true } });
    rejectTenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant2", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "KycTest PG", areaLabel: "Area", city: "City",
        actualName: "KycTest Real", fullAddress: "1 Test Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    bed = await prisma.bed.create({ data: { roomId: room.id, label: "B1", status: "AVAILABLE" } });
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    rejectToken = await signAccessToken({ sub: rejectTenant.id, role: "TENANT" });
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.bed.deleteMany({ where: { roomId: room.id } });
    await prisma.room.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: [tenant.id, rejectTenant.id] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, rejectTenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("starts as NOT_SUBMITTED", async () => {
    const res = await authedInject("GET", "/v1/kyc/me", tenantToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().kyc.status).toBe("NOT_SUBMITTED");
  });

  it("issues a presigned upload URL with a key under the caller's prefix", async () => {
    const res = await authedInject("POST", "/v1/kyc/upload-url", tenantToken, {
      slot: "aadhaar_front",
      contentType: "image/jpeg",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().key).toMatch(new RegExp(`^kyc/${tenant.id}/aadhaar_front-`));
    expect(typeof res.json().uploadUrl).toBe("string");
  });

  it("rejects a disallowed content type (server-side MIME validation)", async () => {
    const res = await authedInject("POST", "/v1/kyc/upload-url", tenantToken, {
      slot: "aadhaar_front",
      contentType: "image/gif",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects keys that are not under the caller's own prefix", async () => {
    const foreign = docsFor(randomUUID()); // someone else's prefix
    const res = await authedInject("POST", "/v1/kyc", tenantToken, foreign);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_KYC_KEY");
  });

  it("submit stores PENDING and the booking gate stays CLOSED until verified", async () => {
    const submit = await authedInject("POST", "/v1/kyc", tenantToken, docsFor(tenant.id));
    expect(submit.statusCode).toBe(201);
    expect(submit.json().status).toBe("PENDING");

    const me = await authedInject("GET", "/v1/kyc/me", tenantToken);
    expect(me.json().kyc.status).toBe("PENDING");

    // Server-enforced gate: cannot even start a booking while PENDING.
    const blocked = await authedInject("POST", "/v1/bookings", tenantToken, { bedId: bed.id });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("KYC_REQUIRED");
  });

  it("after admin verification, booking AND token payment go through", async () => {
    const rec = await prisma.kycRecord.findUniqueOrThrow({ where: { userId: tenant.id } });
    const result = await adminService.approveKyc(admin, rec.id);
    expect(result.status).toBe("VERIFIED");

    const me = await authedInject("GET", "/v1/kyc/me", tenantToken);
    expect(me.json().kyc.status).toBe("VERIFIED");

    // Gate now open: a hold is created.
    const booking = await authedInject("POST", "/v1/bookings", tenantToken, { bedId: bed.id });
    expect(booking.statusCode).toBe(201);
    const bookingId = booking.json().booking.id as string;
    const tokenPaise = booking.json().booking.tokenAmountPaise as number;

    // ...and the token payment can be initiated (gate passed, order returned).
    const pay = await authedInject("POST", `/v1/bookings/${bookingId}/payment`, tenantToken, {
      method: "ONLINE",
      onlinePaise: tokenPaise,
      cashPaise: 0,
    });
    expect(pay.statusCode).toBe(201);
    expect(pay.json().razorpayOrder).toBeDefined();
  });

  it("a rejection surfaces the reason and allows re-upload back to PENDING", async () => {
    const submit = await authedInject("POST", "/v1/kyc", rejectToken, docsFor(rejectTenant.id));
    expect(submit.statusCode).toBe(201);

    const rec = await prisma.kycRecord.findUniqueOrThrow({ where: { userId: rejectTenant.id } });
    await adminService.rejectKyc(admin, rec.id, "Aadhaar photo is blurry");

    const rejected = await authedInject("GET", "/v1/kyc/me", rejectToken);
    expect(rejected.json().kyc.status).toBe("REJECTED");
    expect(rejected.json().kyc.rejectReason).toBe("Aadhaar photo is blurry");

    // Re-upload: status returns to PENDING and the prior reason is cleared.
    const resubmit = await authedInject("POST", "/v1/kyc", rejectToken, docsFor(rejectTenant.id));
    expect(resubmit.statusCode).toBe(201);
    const after = await authedInject("GET", "/v1/kyc/me", rejectToken);
    expect(after.json().kyc.status).toBe("PENDING");
    expect(after.json().kyc.rejectReason).toBeNull();
  });
});
