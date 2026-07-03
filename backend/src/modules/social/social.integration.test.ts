import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { BedStatus, BookingStatus, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { socialRoutes } from "./social.route.js";
import { listingRoutes } from "../listing/listing.route.js";
import { socialService } from "./social.service.js";
import { createRedisPresenceStore } from "./presence.js";

/**
 * Honesty-gated social proof, end-to-end against a live Postgres + Redis. Proves:
 *  - "viewing now" counts DISTINCT sessions (not refreshes) and hides below floor;
 *  - "booked recently" counts ONLY confirmed-paid bookings + walk-ins (an
 *    abandoned hold and an out-of-window booking do NOT count; agent bookings do);
 *  - scarcity reflects LIVE bed inventory (amber ≤2, red at full, omitted when
 *    plenty); and every floor OMITS its field when unmet (never faked).
 *
 * Default env floors apply (viewing 3, booked 3, wishlist 5, amber ≤2, TTL 30s).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("social proof (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let agent: User;
  let tenants: User[]; // reused across bookings + wishlists

  // Listings, one per scenario for clean isolation.
  let lBooked: PgListing; // confirmed+agent+walk-in in window, plus a hold + an old one
  let lFew: PgListing; // 2 confirmed -> below booked floor
  let lAmber: PgListing; // 2 beds free -> amber
  let lFull: PgListing; // 0 beds free -> red
  let lPlenty: PgListing; // many beds free -> omitted
  let lWish5: PgListing; // 5 wishlists -> shown
  let lWish4: PgListing; // 4 wishlists -> omitted (floor 5)
  let lView: PgListing; // 3 distinct viewers -> shown
  let lViewLow: PgListing; // 1 viewer refreshing -> omitted
  let lEmpty: PgListing; // nothing real -> {}

  const createdListingIds: string[] = [];
  const createdUserIds: string[] = [];

  const makeListing = async (alias: string): Promise<PgListing> => {
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias, areaLabel: "Indiranagar", city: "Bengaluru",
        actualName: `${alias} Real`, fullAddress: "1 Social Road", pincode: "560038",
        latitude: 12.97, longitude: 77.64, status: "PUBLISHED",
      },
    });
    createdListingIds.push(l.id);
    return l;
  };

  const makeRoom = (listingId: string): Promise<Room> =>
    prisma.room.create({
      data: { listingId, name: "Room 1", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 },
    });

  const makeBed = async (roomId: string, status: BedStatus): Promise<string> => {
    const bed = await prisma.bed.create({ data: { roomId, label: `B-${randomUUID().slice(0, 8)}`, status } });
    return bed.id;
  };

  const makeBooking = async (
    listingId: string, roomId: string, tenantId: string, status: BookingStatus,
    extra: { confirmedAt?: Date; bookedByAgentId?: string } = {},
  ): Promise<void> => {
    // A live booking needs its own bed (one-live-booking-per-bed).
    const bedStatus: BedStatus = status === "CONFIRMED" || status === "COMPLETED" ? "BOOKED" : "HELD";
    const bedId = await makeBed(roomId, bedStatus);
    await prisma.booking.create({
      data: {
        listingId, bedId, tenantId, status,
        tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
        ...(extra.confirmedAt ? { confirmedAt: extra.confirmedAt } : {}),
        ...(extra.bookedByAgentId ? { bookedByAgentId: extra.bookedByAgentId, agentChannel: "ASSISTED" as const } : {}),
        ...(status === "TOKEN_PENDING" ? { holdExpiresAt: new Date(Date.now() + DAY_MS) } : {}),
      },
    });
  };

  const makeWalkIn = async (listingId: string, roomId: string): Promise<void> => {
    await prisma.walkInTenant.create({
      data: {
        listingId, roomId, hostId: host.id, name: "Walk In", phone: uniquePhone(),
        aadhaarNumber: "999999990000", moveInDate: new Date(), monthlyRentPaise: 1_000_000,
      },
    });
  };

  const wishlistBy = async (listingId: string, users: User[]): Promise<void> => {
    await prisma.wishlist.createMany({ data: users.map((u) => ({ userId: u.id, listingId })) });
  };

  const getSocial = async (listingId: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/listings/${listingId}/social` });
    return res;
  };
  const heartbeat = (listingId: string, sessionId: string) =>
    app.inject({
      method: "POST", url: `/v1/listings/${listingId}/social/heartbeat`, payload: { sessionId },
    });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(socialRoutes, { prefix: "/v1" });
    await app.register(listingRoutes, { prefix: "/v1" }); // for the folded-detail test
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    tenants = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.user.create({ data: { phone: uniquePhone(), fullName: `Tenant ${i}`, role: "TENANT", isPhoneVerified: true } }),
      ),
    );
    createdUserIds.push(host.id, agent.id, ...tenants.map((t) => t.id));

    [lBooked, lFew, lAmber, lFull, lPlenty, lWish5, lWish4, lView, lViewLow, lEmpty] = await Promise.all([
      makeListing("Booked PG"), makeListing("Few PG"), makeListing("Amber PG"), makeListing("Full PG"),
      makeListing("Plenty PG"), makeListing("Wish5 PG"), makeListing("Wish4 PG"), makeListing("View PG"),
      makeListing("ViewLow PG"), makeListing("Empty PG"),
    ]);

    // --- booked-count seed: 2 confirmed + 1 confirmed-by-AGENT + 1 walk-in are
    // REAL and in-window (=> 4). An abandoned hold and a 60-day-old confirmed
    // booking must NOT count.
    const roomBooked = await makeRoom(lBooked.id);
    await makeBooking(lBooked.id, roomBooked.id, tenants[0]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - DAY_MS) });
    await makeBooking(lBooked.id, roomBooked.id, tenants[1]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - 2 * DAY_MS) });
    await makeBooking(lBooked.id, roomBooked.id, tenants[2]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - DAY_MS), bookedByAgentId: agent.id });
    await makeBooking(lBooked.id, roomBooked.id, tenants[3]!.id, "TOKEN_PENDING"); // abandoned hold — excluded
    await makeBooking(lBooked.id, roomBooked.id, tenants[4]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - 60 * DAY_MS) }); // out of window — excluded
    await makeWalkIn(lBooked.id, roomBooked.id); // real move-in — included

    // lFew: only 2 confirmed in window -> below the booked floor of 3.
    const roomFew = await makeRoom(lFew.id);
    await makeBooking(lFew.id, roomFew.id, tenants[0]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - DAY_MS) });
    await makeBooking(lFew.id, roomFew.id, tenants[1]!.id, "CONFIRMED", { confirmedAt: new Date(Date.now() - DAY_MS) });

    // --- scarcity seed: live bed inventory.
    const roomAmber = await makeRoom(lAmber.id);
    await Promise.all([makeBed(roomAmber.id, "AVAILABLE"), makeBed(roomAmber.id, "AVAILABLE"), makeBed(roomAmber.id, "BOOKED"), makeBed(roomAmber.id, "BOOKED")]);
    const roomFull = await makeRoom(lFull.id);
    await Promise.all([makeBed(roomFull.id, "BOOKED"), makeBed(roomFull.id, "BOOKED"), makeBed(roomFull.id, "BLOCKED")]);
    const roomPlenty = await makeRoom(lPlenty.id);
    await Promise.all(Array.from({ length: 5 }, () => makeBed(roomPlenty.id, "AVAILABLE")));

    // --- wishlist seed.
    await wishlistBy(lWish5.id, tenants); // 5 -> shown
    await wishlistBy(lWish4.id, tenants.slice(0, 4)); // 4 -> omitted

    // Compute the cached booked counts once from the real seeded activity.
    await socialService.recomputeBookedCounts();
  });

  afterAll(async () => {
    await prisma.wishlist.deleteMany({ where: { listingId: { in: createdListingIds } } });
    await prisma.walkInTenant.deleteMany({ where: { listingId: { in: createdListingIds } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: createdListingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: createdListingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: createdListingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    // Clear the presence keys this suite created.
    await Promise.all(createdListingIds.map((id) => redis.del(`social:viewing:${id}`)));
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------ viewing
  it("counts DISTINCT viewing sessions (not refreshes) and shows at/above the floor", async () => {
    // Three distinct sessions viewing the same listing.
    for (const s of [randomUUID(), randomUUID(), randomUUID()]) expect((await heartbeat(lView.id, s)).statusCode).toBe(204);
    const social = (await getSocial(lView.id)).json().social;
    expect(social.viewingNow).toBe(3);
  });

  it("does NOT inflate on refreshes and HIDES below the floor", async () => {
    // The SAME session heartbeats four times -> one distinct viewer -> below floor 3.
    const session = randomUUID();
    for (let i = 0; i < 4; i++) expect((await heartbeat(lViewLow.id, session)).statusCode).toBe(204);
    const social = (await getSocial(lViewLow.id)).json().social;
    expect(social).not.toHaveProperty("viewingNow");
  });

  it("presence store: distinct members + a sliding TTL window (deterministic clock)", async () => {
    const store = createRedisPresenceStore(redis);
    const key = randomUUID();
    createdListingIds.push(key); // reuse cleanup (del social:viewing:<key>)
    const t0 = 1_000_000_000_000;
    const ttl = 30;
    await store.heartbeat(key, "s:a", t0, ttl);
    await store.heartbeat(key, "s:b", t0, ttl);
    await store.heartbeat(key, "s:a", t0 + 1000, ttl); // same session again -> still ONE member, window slides
    expect(await store.countActive(key, t0 + 2000, ttl)).toBe(2);
    // Past s:b's window but within s:a's (it re-heartbeated): the idle session
    // ages out, the active one survives — a genuine per-session sliding window.
    expect(await store.countActive(key, t0 + ttl * 1000 + 1, ttl)).toBe(1);
    // Past s:a's last heartbeat + TTL too -> everyone has aged out.
    expect(await store.countActive(key, t0 + 1000 + ttl * 1000 + 1, ttl)).toBe(0);
  });

  // ------------------------------------------------------------------- booked
  it("counts only confirmed-PAID bookings + walk-ins (hold & out-of-window excluded, agent included)", async () => {
    const social = (await getSocial(lBooked.id)).json().social;
    // 2 confirmed + 1 agent-confirmed + 1 walk-in = 4; the hold and the 60-day-old one are excluded.
    expect(social.bookedRecently).toEqual({ count: 4, windowDays: 7 });
  });

  it("omits the booked widget below the floor (an abandoned hold never bumps it)", async () => {
    const social = (await getSocial(lFew.id)).json().social;
    expect(social).not.toHaveProperty("bookedRecently");
  });

  // ------------------------------------------------------------------ scarcity
  it("reflects LIVE beds: amber when few remain", async () => {
    expect((await getSocial(lAmber.id)).json().social.bedsLeft).toEqual({ count: 2, level: "amber" });
  });
  it("reflects LIVE beds: red when fully booked", async () => {
    expect((await getSocial(lFull.id)).json().social.bedsLeft).toEqual({ count: 0, level: "red" });
  });
  it("omits scarcity when there is plenty of availability (no false urgency)", async () => {
    expect((await getSocial(lPlenty.id)).json().social).not.toHaveProperty("bedsLeft");
  });

  // ------------------------------------------------------------------ wishlist
  it("shows the real wishlist count at/above the floor, omits it below", async () => {
    expect((await getSocial(lWish5.id)).json().social.wishlistedCount).toBe(5);
    expect((await getSocial(lWish4.id)).json().social).not.toHaveProperty("wishlistedCount");
  });

  // --------------------------------------------------------------- empty + wiring
  it("returns an empty object when nothing is real enough to show", async () => {
    const social = (await getSocial(lEmpty.id)).json().social;
    expect(social).toEqual({});
  });

  it("folds the honesty-gated social proof into the listing detail payload", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/listings/${lAmber.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.listing.id).toBe(lAmber.id);
    expect(body.social.bedsLeft).toEqual({ count: 2, level: "amber" });
  });

  it("404s social/heartbeat for a listing that does not exist; 400s an anonymous heartbeat with no session", async () => {
    expect((await getSocial(randomUUID())).statusCode).toBe(404);
    expect((await heartbeat(randomUUID(), randomUUID())).statusCode).toBe(404);
    const noSession = await app.inject({ method: "POST", url: `/v1/listings/${lView.id}/social/heartbeat`, payload: {} });
    expect(noSession.statusCode).toBe(400);
  });
});
