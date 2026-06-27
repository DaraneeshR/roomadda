import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { wishlistRoutes } from "./wishlist.route.js";

/**
 * Wishlist is strictly per-user: one tenant never sees another's saved listings.
 * Saved listings come back MASKED; add/remove are idempotent; non-tenants and
 * unknown listings are rejected.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("wishlist (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let alice: User;
  let bob: User;
  let l1: PgListing;
  let l2: PgListing;
  let aliceToken: string;
  let bobToken: string;
  let hostToken: string;

  async function makeListing(): Promise<PgListing> {
    return prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Wish PG", areaLabel: "Area", city: "WishCity",
        actualName: "Wish Real", fullAddress: "1 Wish Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
  }

  const save = (token: string, id: string) =>
    app.inject({ method: "POST", url: `/v1/wishlist/${id}`, headers: { authorization: `Bearer ${token}` } });
  const unsave = (token: string, id: string) =>
    app.inject({ method: "DELETE", url: `/v1/wishlist/${id}`, headers: { authorization: `Bearer ${token}` } });
  async function listMine(token: string) {
    const res = await app.inject({ method: "GET", url: "/v1/wishlist", headers: { authorization: `Bearer ${token}` } });
    return res.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(wishlistRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
    alice = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Alice", role: "TENANT", isPhoneVerified: true } });
    bob = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Bob", role: "TENANT", isPhoneVerified: true } });
    l1 = await makeListing();
    l2 = await makeListing();
    aliceToken = await signAccessToken({ sub: alice.id, role: "TENANT" });
    bobToken = await signAccessToken({ sub: bob.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.wishlist.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: [l1.id, l2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, alice.id, bob.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("saves a listing (idempotently) and returns it masked", async () => {
    expect((await save(aliceToken, l1.id)).statusCode).toBe(201);
    expect((await save(aliceToken, l1.id)).statusCode).toBe(201); // idempotent

    const page = await listMine(aliceToken);
    expect(page.items.map((i) => i.id)).toEqual([l1.id]);
    expect(page.items[0]!.masked).toBe(true);
    expect("actualName" in page.items[0]!).toBe(false);
  });

  it("is per-user — Bob does not see Alice's saves", async () => {
    expect((await listMine(bobToken)).items).toHaveLength(0);
  });

  it("removes a save (idempotently)", async () => {
    await save(aliceToken, l2.id);
    expect((await listMine(aliceToken)).items.map((i) => i.id).sort()).toEqual([l1.id, l2.id].sort());

    expect((await unsave(aliceToken, l1.id)).statusCode).toBe(204);
    expect((await unsave(aliceToken, l1.id)).statusCode).toBe(204); // idempotent
    expect((await listMine(aliceToken)).items.map((i) => i.id)).toEqual([l2.id]);
  });

  it("404s saving a listing that does not exist", async () => {
    expect((await save(aliceToken, randomUUID())).statusCode).toBe(404);
  });

  it("is TENANT-only (default-deny for other roles)", async () => {
    expect((await save(hostToken, l1.id)).statusCode).toBe(403);
    const res = await app.inject({ method: "GET", url: "/v1/wishlist", headers: { authorization: `Bearer ${hostToken}` } });
    expect(res.statusCode).toBe(403);
  });
});
