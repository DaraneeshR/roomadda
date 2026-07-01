import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Bed, Booking, PgListing, Room, User } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { leaveNoticeRoutes } from "./leave-notice.route.js";

/**
 * Leave-notice flow against a live DB: serving notice requires an active stay and
 * a move-out at least the notice period away; serving flags the bed Vacating
 * Soon; a notice can't be withdrawn within 3 days of move-out, and a valid
 * withdrawal clears the bed flag.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY_MS);

describe("leave notice (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let tenant: User; // active stay
  let other: User; // no active stay
  let listing: PgListing;
  let room: Room;
  let bed: Bed;
  let booking: Booking;
  let tenantToken: string;
  let otherToken: string;
  const listingIds: string[] = [];

  const send = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(leaveNoticeRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "LN Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "LN Tenant", role: "TENANT", isPhoneVerified: true } });
    other = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "No Stay", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "LN PG", areaLabel: "Area", city: "City",
        actualName: "LN Real Name", fullAddress: "1 LN Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    listingIds.push(listing.id);
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 },
    });
    bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 6)}`, status: "BOOKED" } });
    booking = await prisma.booking.create({
      data: {
        bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "CONFIRMED",
        tokenAmountPaise: 500_000, monthlyRentPaise: 1_000_000, depositPaise: 500_000,
        moveInDate: inDays(-30), confirmedAt: new Date(),
      },
    });

    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    otherToken = await signAccessToken({ sub: other.id, role: "TENANT" });
  });

  afterAll(async () => {
    await prisma.leaveNotice.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, other.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("rejects a move-out date inside the notice period", async () => {
    const res = await send("POST", "/v1/leave-notices", tenantToken, { moveOutDate: inDays(10).toISOString() });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NOTICE_PERIOD_NOT_MET");
  });

  it("requires an active stay", async () => {
    const res = await send("POST", "/v1/leave-notices", otherToken, { moveOutDate: inDays(40).toISOString() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_STAY");
  });

  it("serves notice, flags the bed Vacating Soon, then a valid withdrawal clears it", async () => {
    const res = await send("POST", "/v1/leave-notices", tenantToken, { moveOutDate: inDays(40).toISOString() });
    expect(res.statusCode).toBe(201);
    const notice = res.json().notice;
    expect(notice.status).toBe("ACTIVE");
    expect(notice.canWithdraw).toBe(true);

    // Bed is queued Vacating Soon.
    const vacating = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(vacating?.vacatingSoon).toBe(true);
    expect(vacating?.vacatingFrom).not.toBeNull();

    // The list carries the policy the form needs.
    const list = await send("GET", "/v1/leave-notices", tenantToken);
    expect(list.json().noticePeriodDays).toBe(30);
    expect(typeof list.json().earliestMoveOutDate).toBe("string");

    // Withdraw (well outside the 3-day lock) → WITHDRAWN + bed flag cleared.
    const withdraw = await send("POST", `/v1/leave-notices/${notice.id}/withdraw`, tenantToken);
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().notice.status).toBe("WITHDRAWN");
    const cleared = await prisma.bed.findUnique({ where: { id: bed.id } });
    expect(cleared?.vacatingSoon).toBe(false);
    expect(cleared?.vacatingFrom).toBeNull();
  });

  it("cannot withdraw within 3 days of move-out", async () => {
    // Seed an ACTIVE notice with an imminent move-out (bypasses the create rule).
    const near = await prisma.leaveNotice.create({
      data: { bookingId: booking.id, tenantId: tenant.id, listingId: listing.id, bedId: bed.id, moveOutDate: inDays(2), status: "ACTIVE" },
    });
    const res = await send("POST", `/v1/leave-notices/${near.id}/withdraw`, tenantToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("WITHDRAW_LOCKED");
  });
});
