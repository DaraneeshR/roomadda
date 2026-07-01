import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bed, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { smsSender } from "../../lib/sms.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { hostRoutes } from "./host.route.js";

/**
 * Host surface end-to-end against a live DB. Proves the non-negotiables: every
 * route is ownership-scoped (a host can't touch another host's listing/tenant/
 * menu), host responses never leak tenant KYC, the §9.2 gate holds on the publish
 * path, a >20% rent edit re-queues, a walk-in reduces inventory + fires the invite,
 * broadcasts are capped at 3/day, and the roster never leaks another tenant's data.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const SECRET_KYC_REF = "SECRET_KYC_DOCREF_DO_NOT_LEAK";

interface ListingFixture {
  listing: PgListing;
  room: Room;
  beds: Bed[];
}

describe("host surface (integration)", () => {
  let app: FastifyInstance;
  let hostA: User;
  let hostB: User;
  let tenantT: User; // confirmed tenant on hostA's listing
  let tenantU: User; // confirmed tenant on hostB's listing
  let tokenA: string;
  let tokenB: string;
  const listingIds: string[] = [];
  const userIds: string[] = [];

  const send = (token: string) => (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });

  /** Create a listing for `host` with one room + `bedCount` beds + `photoCount` photos. */
  async function makeListing(
    host: User,
    opts: { status?: "DRAFT" | "PUBLISHED"; bedCount?: number; photoCount?: number; rentPaise?: number } = {},
  ): Promise<ListingFixture> {
    const { status = "PUBLISHED", bedCount = 3, photoCount = 5, rentPaise = 1_000_000 } = opts;
    const listing = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias: "PG " + Math.random().toString(36).slice(2, 7),
        areaLabel: "Koramangala",
        city: "Bengaluru",
        actualName: "Real Name PG",
        fullAddress: "123 Real Street",
        pincode: "560034",
        latitude: 12.9352,
        longitude: 77.6245,
        status,
      },
    });
    listingIds.push(listing.id);
    const room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room A", sharingType: 3, monthlyRentPaise: rentPaise, depositPaise: rentPaise },
    });
    const beds: Bed[] = [];
    for (let i = 0; i < bedCount; i++) {
      beds.push(await prisma.bed.create({ data: { roomId: room.id, label: `B${i + 1}`, status: "AVAILABLE" } }));
    }
    for (let i = 0; i < photoCount; i++) {
      await prisma.listingPhoto.create({ data: { listingId: listing.id, url: `https://cdn/x${i}.jpg`, sortOrder: i } });
    }
    return { listing, room, beds };
  }

  async function makeConfirmedBooking(tenant: User, fx: ListingFixture): Promise<string> {
    const bed = fx.beds[0]!;
    await prisma.bed.update({ where: { id: bed.id }, data: { status: "BOOKED" } });
    const booking = await prisma.booking.create({
      data: {
        bedId: bed.id,
        tenantId: tenant.id,
        listingId: fx.listing.id,
        status: "CONFIRMED",
        tokenAmountPaise: 500_000,
        monthlyRentPaise: fx.room.monthlyRentPaise,
        depositPaise: fx.room.depositPaise,
        moveInDate: new Date(Date.now() - 86_400_000),
        confirmedAt: new Date(),
      },
    });
    return booking.id;
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(hostRoutes, { prefix: "/v1" });
    await app.ready();

    [hostA, hostB, tenantT, tenantU] = await Promise.all([
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host A", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host B", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant Tara", role: "TENANT", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant Uma", role: "TENANT", isPhoneVerified: true } }),
    ]);
    userIds.push(hostA.id, hostB.id, tenantT.id, tenantU.id);

    // hostA KYC VERIFIED (needed for the publish gate). tenantT has a KYC record
    // with a recognizable docRef we assert never leaks through a host response.
    await prisma.kycRecord.create({ data: { userId: hostA.id, status: "VERIFIED", docType: "AADHAAR" } });
    await prisma.kycRecord.create({ data: { userId: tenantT.id, status: "VERIFIED", docType: "AADHAAR", docRef: SECRET_KYC_REF } });

    tokenA = await signAccessToken({ sub: hostA.id, role: "HOST" });
    tokenB = await signAccessToken({ sub: hostB.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("ownership: a host cannot read or mutate another host's listing", async () => {
    const fx = await makeListing(hostA);
    const asB = send(tokenB);
    // Every cross-host access is a 404 (existence never leaked).
    expect((await asB("GET", `/v1/host/listings/${fx.listing.id}`)).statusCode).toBe(404);
    expect((await asB("PATCH", `/v1/host/listings/${fx.listing.id}`, { alias: "Hijack" })).statusCode).toBe(404);
    expect((await asB("GET", `/v1/host/listings/${fx.listing.id}/roster`)).statusCode).toBe(404);
    expect((await asB("POST", `/v1/host/listings/${fx.listing.id}/broadcast`, { body: "hi" })).statusCode).toBe(404);
    expect(
      (await asB("POST", `/v1/host/listings/${fx.listing.id}/walk-ins`, {
        roomId: fx.room.id,
        name: "X",
        phone: uniquePhone(),
        aadhaarNumber: "123456789012",
        moveInDate: new Date().toISOString(),
        monthlyRentPaise: 1_000_000,
      })).statusCode,
    ).toBe(404);
    // The owner CAN read it.
    expect((await send(tokenA)("GET", `/v1/host/listings/${fx.listing.id}`)).statusCode).toBe(200);
  });

  it("§9.2 gate holds on the publish path; passes once requirements are met", async () => {
    const fx = await makeListing(hostA, { status: "DRAFT", photoCount: 0 });
    const fail = await send(tokenA)("POST", `/v1/host/listings/${fx.listing.id}/publish`);
    expect(fail.statusCode).toBe(422);
    expect(fail.json().error.code).toBe("LISTING_NOT_PUBLISHABLE");
    expect(fail.json().error.details.failed).toContain("photos");

    for (let i = 0; i < 5; i++) {
      await prisma.listingPhoto.create({ data: { listingId: fx.listing.id, url: `https://cdn/p${i}.jpg`, sortOrder: i } });
    }
    const ok = await send(tokenA)("POST", `/v1/host/listings/${fx.listing.id}/publish`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().listing.status).toBe("PUBLISHED");
  });

  it("a rent change > 20% re-queues; a minor edit goes live immediately", async () => {
    const fx = await makeListing(hostA, { status: "PUBLISHED", rentPaise: 1_000_000 });
    const asA = send(tokenA);

    const minor = await asA("PATCH", `/v1/host/listings/${fx.listing.id}`, { alias: "Sunset Stay" });
    expect(minor.statusCode).toBe(200);
    expect(minor.json().requeued).toBe(false);
    expect(minor.json().listing.status).toBe("PUBLISHED");

    const bigRent = await asA("PATCH", `/v1/host/listings/${fx.listing.id}/rooms/${fx.room.id}`, {
      monthlyRentPaise: 1_300_000, // +30%
    });
    expect(bigRent.statusCode).toBe(200);
    expect(bigRent.json().requeued).toBe(true);
    expect(bigRent.json().listing.status).toBe("PENDING_REVIEW");

    // An address change also re-queues.
    await prisma.pgListing.update({ where: { id: fx.listing.id }, data: { status: "PUBLISHED" } });
    const addr = await asA("PATCH", `/v1/host/listings/${fx.listing.id}`, { fullAddress: "456 New Road" });
    expect(addr.json().requeued).toBe(true);
  });

  it("walk-in reduces room inventory AND fires the app-invite SMS", async () => {
    const fx = await makeListing(hostA, { bedCount: 3 });
    const before = await prisma.bed.count({ where: { roomId: fx.room.id, status: "AVAILABLE" } });
    const inviteSpy = vi.spyOn(smsSender, "sendWalkInInvite").mockResolvedValue();
    try {
      const res = await send(tokenA)("POST", `/v1/host/listings/${fx.listing.id}/walk-ins`, {
        roomId: fx.room.id,
        name: "Walk In Wally",
        phone: uniquePhone(),
        aadhaarNumber: "987654321098",
        moveInDate: new Date().toISOString(),
        monthlyRentPaise: 900_000,
        depositPaise: 900_000,
        paymentMode: "CASH",
      });
      expect(res.statusCode).toBe(201);
      // Aadhaar is never returned in full — only the last 4 digits.
      expect(res.json().walkIn.aadhaarLast4).toBe("1098");
      expect(JSON.stringify(res.json())).not.toContain("987654321098");

      // Invite fired exactly once.
      expect(inviteSpy).toHaveBeenCalledTimes(1);
      expect(inviteSpy.mock.calls[0]?.[0].registrationToken).toBeTruthy();

      // Availability dropped by one (a bed is now BLOCKED, distinct from BOOKED).
      const after = await prisma.bed.count({ where: { roomId: fx.room.id, status: "AVAILABLE" } });
      expect(after).toBe(before - 1);
      expect(await prisma.bed.count({ where: { roomId: fx.room.id, status: "BLOCKED" } })).toBe(1);
    } finally {
      inviteSpy.mockRestore();
    }
  });

  it("broadcast is capped at 3/day and is mirrored into each current tenant's chat", async () => {
    const fx = await makeListing(hostA);
    await makeConfirmedBooking(tenantT, fx);
    const asA = send(tokenA);

    for (let i = 0; i < 3; i++) {
      const ok = await asA("POST", `/v1/host/listings/${fx.listing.id}/broadcast`, { body: `Notice ${i}` });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().recipientCount).toBe(1); // the one confirmed tenant
      expect(ok.json().remainingToday).toBe(2 - i);
    }
    const fourth = await asA("POST", `/v1/host/listings/${fx.listing.id}/broadcast`, { body: "Over the limit" });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe("BROADCAST_LIMIT_REACHED");

    // Logged into the tenant's chat thread (3 HOST messages).
    const messages = await prisma.chatMessage.count({
      where: { senderRole: "HOST", conversation: { tenantId: tenantT.id, listingId: fx.listing.id } },
    });
    expect(messages).toBe(3);
  });

  it("roster shows the host's own tenants only, with no KYC and no other tenant's data", async () => {
    const fxA = await makeListing(hostA);
    await makeConfirmedBooking(tenantT, fxA);
    const fxB = await makeListing(hostB);
    await makeConfirmedBooking(tenantU, fxB);

    const res = await send(tokenA)("GET", `/v1/host/listings/${fxA.listing.id}/roster?scope=current`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.items.map((t: { name: string }) => t.name);
    expect(names).toContain("Tenant Tara");
    // hostB's tenant never appears in hostA's roster.
    expect(names).not.toContain("Tenant Uma");
    // No KYC / no leaked tenant document reference, no phone field.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(SECRET_KYC_REF);
    expect(raw.toLowerCase()).not.toContain("aadhaar");
    expect(body.items[0]).not.toHaveProperty("phone");
  });

  it("host booking-request + service feeds never carry tenant KYC", async () => {
    const fx = await makeListing(hostA);
    const bookingId = await makeConfirmedBooking(tenantT, fx);
    await prisma.serviceRequest.create({
      data: {
        ticketNumber: "SR-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
        bookingId,
        tenantId: tenantT.id,
        listingId: fx.listing.id,
        category: "PLUMBING",
        description: "Leaky tap",
      },
    });

    const requests = await send(tokenA)("GET", "/v1/host/booking-requests");
    expect(requests.statusCode).toBe(200);
    expect(JSON.stringify(requests.json())).not.toContain(SECRET_KYC_REF);

    const queue = await send(tokenA)("GET", "/v1/host/service-requests");
    expect(queue.statusCode).toBe(200);
    const queueRaw = JSON.stringify(queue.json());
    expect(queueRaw).toContain("Tenant Tara"); // tenant name is shown
    expect(queueRaw).not.toContain(SECRET_KYC_REF); // but never the KYC ref
    expect(queue.json().stats).toHaveProperty("avgResolutionHours");
  });

  it("hosts can NEVER delete a service request (no delete route exists)", async () => {
    const fx = await makeListing(hostA);
    const bookingId = await makeConfirmedBooking(tenantT, fx);
    const sr = await prisma.serviceRequest.create({
      data: {
        ticketNumber: "SR-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
        bookingId,
        tenantId: tenantT.id,
        listingId: fx.listing.id,
        category: "WIFI",
        description: "No internet",
      },
    });
    const del = await send(tokenA)("DELETE", `/v1/host/service-requests/${sr.id}`);
    expect(del.statusCode).toBe(404); // route does not exist
  });
});
