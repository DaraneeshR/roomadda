import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { BookingStatus, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { reviewRoutes } from "./review.route.js";
import { listingRoutes } from "../listing/listing.route.js";

/**
 * Reviews & ratings, end-to-end against a live Postgres. Proves the write gate
 * (only an eligible stay may review, one review per booking), that the listing's
 * cached aggregate is maintained on each new review (visible on the reviews
 * summary AND the public listing serializer), that the public read is
 * cursor-paginated newest-first with a clean empty state, and that a host may
 * respond ONLY on a listing they own (default-deny).
 *
 * Bookings are seeded directly so each scenario is independent of the
 * payment/webhook flow. The app is the real wiring (authenticate + requireRole +
 * the service's eligibility/ownership checks + serializers).
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("reviews & ratings (integration)", () => {
  let app: FastifyInstance;
  let host: User; // owns listingA
  let host2: User; // owns listingB (empty state)
  let t1: User; // CONFIRMED stay on A
  let t2: User; // CONFIRMED stay on A
  let t3: User; // TOKEN_PENDING (ineligible) stay on A
  let listingA: PgListing;
  let listingB: PgListing;
  let room: Room;

  let bookingT1: string;
  let bookingT2: string;
  let bookingT3: string;

  const userIds: string[] = [];
  const tokens = new Map<string, string>();
  const tokenFor = (u: User) => tokens.get(u.id)!;

  const makeListing = (hostId: string, alias: string): Promise<PgListing> =>
    prisma.pgListing.create({
      data: {
        hostId, alias, areaLabel: "Indiranagar", city: "Bengaluru",
        actualName: `${alias} Real`, fullAddress: "1 Review Road", pincode: "560038",
        latitude: 12.97, longitude: 77.64, status: "PUBLISHED",
      },
    });

  const freshBed = (label: string) =>
    prisma.bed.create({
      data: { roomId: room.id, label: `${label}-${randomUUID().slice(0, 8)}`, status: "BOOKED" },
    });

  const seedBooking = async (tenantId: string, status: BookingStatus, listingId: string) => {
    const bed = await freshBed(status);
    const booking = await prisma.booking.create({
      data: {
        tenantId, bedId: bed.id, listingId, status,
        tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
      },
    });
    return booking.id;
  };

  const post = (url: string, token: string | undefined, payload: unknown) =>
    app.inject({ method: "POST", url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload: payload as object });
  const get = (url: string, token?: string) =>
    app.inject({ method: "GET", url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(reviewRoutes, { prefix: "/v1" });
    await app.register(listingRoutes, { prefix: "/v1" });
    await app.ready();

    [host, host2, t1, t2, t3] = await Promise.all([
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host Hema", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host Two", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Priya K", role: "TENANT", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Rahul M", role: "TENANT", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Sara P", role: "TENANT", isPhoneVerified: true } }),
    ]);
    userIds.push(host.id, host2.id, t1.id, t2.id, t3.id);
    for (const u of [host, host2, t1, t2, t3]) tokens.set(u.id, await signAccessToken({ sub: u.id, role: u.role }));

    listingA = await makeListing(host.id, "Review PG A");
    listingB = await makeListing(host2.id, "Review PG B");
    room = await prisma.room.create({
      data: { listingId: listingA.id, name: "Room 101", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 },
    });

    bookingT1 = await seedBooking(t1.id, "CONFIRMED", listingA.id);
    bookingT2 = await seedBooking(t2.id, "CONFIRMED", listingA.id);
    bookingT3 = await seedBooking(t3.id, "TOKEN_PENDING", listingA.id);
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { listingId: { in: [listingA.id, listingB.id] } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: [listingA.id, listingB.id] } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: listingA.id } } });
    await prisma.room.deleteMany({ where: { listingId: listingA.id } });
    await prisma.pgListing.deleteMany({ where: { id: { in: [listingA.id, listingB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  // --- write gate ----------------------------------------------------------

  it("rejects a tenant whose stay is not eligible (not confirmed) with 403", async () => {
    const res = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(t3), { bookingId: bookingT3, rating: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("REVIEW_NOT_ELIGIBLE");
  });

  it("rejects reviewing from a booking that is not the caller's (404, no leak)", async () => {
    const res = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(t1), { bookingId: bookingT2, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it("rejects reviewing when the booking is on a different listing (404)", async () => {
    const res = await post(`/v1/listings/${listingB.id}/reviews`, tokenFor(t1), { bookingId: bookingT1, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an unauthenticated writer (401) and a non-tenant role (403)", async () => {
    const anon = await post(`/v1/listings/${listingA.id}/reviews`, undefined, { bookingId: bookingT1, rating: 5 });
    expect(anon.statusCode).toBe(401);
    const asHost = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(host), { bookingId: bookingT1, rating: 5 });
    expect(asHost.statusCode).toBe(403);
  });

  // --- happy path + aggregate ----------------------------------------------

  it("lets an eligible tenant review, and updates the cached aggregate everywhere", async () => {
    // Empty state before any review: null average, count 0 — on both the reviews
    // summary and the public listing serializer.
    const before = await get(`/v1/listings/${listingA.id}/reviews`);
    expect(before.json().summary).toEqual({ ratingAverage: null, ratingCount: 0 });
    const listingBefore = await get(`/v1/listings/${listingA.id}`);
    expect(listingBefore.json().listing.ratingAverage).toBeNull();
    expect(listingBefore.json().listing.ratingCount).toBe(0);

    const first = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(t1), { bookingId: bookingT1, rating: 4, text: "Clean and safe." });
    expect(first.statusCode).toBe(201);
    expect(first.json().review).toMatchObject({ rating: 4, text: "Clean and safe.", authorName: "Priya K", hostResponse: null });

    // Aggregate reflects the single 4-star review.
    expect((await get(`/v1/listings/${listingA.id}/reviews`)).json().summary).toEqual({ ratingAverage: 4, ratingCount: 1 });

    const second = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(t2), { bookingId: bookingT2, rating: 5 });
    expect(second.statusCode).toBe(201);
    expect(second.json().review.text).toBeNull(); // star-only review

    // (4 + 5) / 2 = 4.5, count 2 — reflected on the summary AND the listing card.
    expect((await get(`/v1/listings/${listingA.id}/reviews`)).json().summary).toEqual({ ratingAverage: 4.5, ratingCount: 2 });
    const listingAfter = await get(`/v1/listings/${listingA.id}`);
    expect(listingAfter.json().listing.ratingAverage).toBe(4.5);
    expect(listingAfter.json().listing.ratingCount).toBe(2);
  });

  it("enforces one review per booking (409) and does NOT double-count the aggregate", async () => {
    const dup = await post(`/v1/listings/${listingA.id}/reviews`, tokenFor(t1), { bookingId: bookingT1, rating: 1 });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("REVIEW_EXISTS");
    // Still 2 reviews, average unchanged (the failed insert bumped nothing).
    expect((await get(`/v1/listings/${listingA.id}/reviews`)).json().summary).toEqual({ ratingAverage: 4.5, ratingCount: 2 });
  });

  // --- public read (paginated, newest first, no auth) ----------------------

  it("serves reviews publicly, cursor-paginated, newest first", async () => {
    const page1 = await get(`/v1/listings/${listingA.id}/reviews?limit=1`);
    expect(page1.statusCode).toBe(200); // no auth required
    const body1 = page1.json();
    expect(body1.items).toHaveLength(1);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await get(`/v1/listings/${listingA.id}/reviews?limit=1&cursor=${body1.nextCursor}`);
    const body2 = page2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull(); // no third page

    const ordered = [...body1.items, ...body2.items];
    expect(ordered.map((r) => r.id)).toEqual([...new Set(ordered.map((r) => r.id))]); // distinct
    // Newest first: createdAt is non-increasing across the pages.
    expect(new Date(ordered[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(ordered[1].createdAt).getTime());
  });

  it("returns a clean empty state for a listing with zero reviews", async () => {
    const res = await get(`/v1/listings/${listingB.id}/reviews`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().summary).toEqual({ ratingAverage: null, ratingCount: 0 });
  });

  // --- host response (own listing only) ------------------------------------

  it("lets the owning host respond, but no one else", async () => {
    const reviewId = (await get(`/v1/listings/${listingA.id}/reviews`)).json().items[0].id as string;

    // A different host does not own this listing -> 403.
    const foreign = await post(`/v1/reviews/${reviewId}/response`, tokenFor(host2), { text: "Not my listing" });
    expect(foreign.statusCode).toBe(403);

    // A tenant cannot use the host-only endpoint -> 403 (default-deny by role).
    const asTenant = await post(`/v1/reviews/${reviewId}/response`, tokenFor(t1), { text: "I'm not a host" });
    expect(asTenant.statusCode).toBe(403);

    // The owning host replies -> 200, response is attached and timestamped.
    const owner = await post(`/v1/reviews/${reviewId}/response`, tokenFor(host), { text: "Thanks for staying with us!" });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().review.hostResponse).toBe("Thanks for staying with us!");
    expect(owner.json().review.respondedAt).not.toBeNull();

    // The reply is visible on the public read.
    const publicReview = (await get(`/v1/listings/${listingA.id}/reviews`)).json().items.find((r: { id: string }) => r.id === reviewId);
    expect(publicReview.hostResponse).toBe("Thanks for staying with us!");
  });

  it("404s a host responding to a review that does not exist", async () => {
    const res = await post(`/v1/reviews/${randomUUID()}/response`, tokenFor(host), { text: "ghost" });
    expect(res.statusCode).toBe(404);
  });
});
