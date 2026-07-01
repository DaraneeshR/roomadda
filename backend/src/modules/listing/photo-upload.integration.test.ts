import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { listingRoutes } from "./listing.route.js";

/**
 * On-device listing-photo upload presign (POST /v1/listings/:id/photos/upload-url).
 * Proves the gate: the owning host gets a presigned PUT + the public URL to
 * attach; a non-owner host is 404 (existence never leaked — the URL is writable);
 * a non-host role is 403; and the key is scoped to the listing so it can't be
 * forged. Storage is the dev stub (NODE_ENV=test), so the URLs are deterministic.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("listing photo upload-url (integration)", () => {
  let app: FastifyInstance;
  let hostA: User;
  let hostB: User;
  let tenant: User;
  let listing: PgListing;
  let tokenA: string;
  let tokenB: string;
  let tokenTenant: string;
  const userIds: string[] = [];

  const send = (token?: string) => (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(payload ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(listingRoutes, { prefix: "/v1" });
    await app.ready();

    [hostA, hostB, tenant] = await Promise.all([
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host A", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Host B", role: "HOST", isPhoneVerified: true } }),
      prisma.user.create({ data: { phone: uniquePhone(), fullName: "Tenant T", role: "TENANT", isPhoneVerified: true } }),
    ]);
    userIds.push(hostA.id, hostB.id, tenant.id);

    listing = await prisma.pgListing.create({
      data: {
        hostId: hostA.id,
        alias: "Upload PG",
        areaLabel: "Indiranagar",
        city: "Bengaluru",
        actualName: "Upload Real Name",
        fullAddress: "1 Upload Road",
        pincode: "560038",
        latitude: 12.9784,
        longitude: 77.6408,
        status: "DRAFT",
      },
    });

    [tokenA, tokenB, tokenTenant] = await Promise.all([
      signAccessToken({ sub: hostA.id, role: "HOST" }),
      signAccessToken({ sub: hostB.id, role: "HOST" }),
      signAccessToken({ sub: tenant.id, role: "TENANT" }),
    ]);
  });

  afterAll(async () => {
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const url = (id: string) => `/v1/listings/${id}/photos/upload-url`;

  it("the owning host gets a presigned PUT + a listing-scoped key + the public URL", async () => {
    const res = await send(tokenA)("POST", url(listing.id), { contentType: "image/jpeg" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.uploadUrl).toBe("string");
    expect(body.uploadUrl.length).toBeGreaterThan(0);
    // The key is scoped to the listing (cannot be forged onto another listing).
    expect(body.key.startsWith(`listings/${listing.id}/`)).toBe(true);
    expect(body.key.endsWith(".jpg")).toBe(true);
    // The public URL is what the client attaches; it must be a usable absolute URL.
    expect(body.publicUrl).toMatch(/^https?:\/\//);
    expect(body.publicUrl).toContain(body.key);
    expect(body.expiresInSeconds).toBeGreaterThan(0);
  });

  it("a non-owner host is 404 (existence never leaked)", async () => {
    const res = await send(tokenB)("POST", url(listing.id), { contentType: "image/jpeg" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("a non-existent listing is 404 for the would-be owner too", async () => {
    const res = await send(tokenA)("POST", url(randomUUID()), { contentType: "image/jpeg" });
    expect(res.statusCode).toBe(404);
  });

  it("a non-host role is denied (default-deny)", async () => {
    const res = await send(tokenTenant)("POST", url(listing.id), { contentType: "image/jpeg" });
    expect(res.statusCode).toBe(403);
  });

  it("an unauthenticated request is rejected", async () => {
    const res = await send()("POST", url(listing.id), { contentType: "image/jpeg" });
    expect(res.statusCode).toBe(401);
  });

  it("an unsupported content type is rejected at the boundary", async () => {
    const res = await send(tokenA)("POST", url(listing.id), { contentType: "image/gif" });
    expect(res.statusCode).toBe(400);
  });
});
