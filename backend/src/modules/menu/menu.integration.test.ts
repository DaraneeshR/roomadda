import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { mealMenuRoutes } from "./menu.route.js";

/**
 * Meal-menu routes against a live DB: the tenant reads today + tomorrow, empty
 * slots come back as the "not available" / "not updated" shape, and only the
 * OWNING host may write (default-deny + ownership). The minimal POST is what
 * seeds the data until the full host-update UI lands.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("meal menu routes (integration)", () => {
  let app: FastifyInstance;
  let host: User;
  let otherHost: User;
  let tenant: User;
  let listing: PgListing;
  let tenantToken: string;
  let hostToken: string;
  let otherHostToken: string;

  // A fixed anchor day so POST and GET key the same calendar date deterministically.
  const anchor = new Date("2026-06-28T09:00:00Z");
  const tomorrow = "2026-06-29";

  const send = (method: "GET" | "POST", url: string, token?: string, payload?: unknown) =>
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
    await app.register(mealMenuRoutes, { prefix: "/v1" });
    await app.ready();

    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Menu Host", role: "HOST", isPhoneVerified: true } });
    otherHost = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Other Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Menu Tenant", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Menu PG", areaLabel: "Area", city: "City",
        actualName: "Menu Real Name", fullAddress: "1 Menu Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
    hostToken = await signAccessToken({ sub: host.id, role: "HOST" });
    otherHostToken = await signAccessToken({ sub: otherHost.id, role: "HOST" });
  });

  afterAll(async () => {
    await prisma.mealMenu.deleteMany({ where: { listingId: listing.id } });
    await prisma.pgListing.deleteMany({ where: { id: listing.id } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, otherHost.id, tenant.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("only the owning host can write the menu", async () => {
    const payload = {
      date: anchor.toISOString(),
      breakfast: { text: "Poha & chai" },
      lunch: { notAvailable: true },
      // dinner omitted → empty slot
    };

    // A different host cannot write to this listing.
    const forbidden = await send("POST", `/v1/listings/${listing.id}/menu`, otherHostToken, payload);
    expect(forbidden.statusCode).toBe(403);

    // A tenant cannot write either (wrong role).
    const wrongRole = await send("POST", `/v1/listings/${listing.id}/menu`, tenantToken, payload);
    expect(wrongRole.statusCode).toBe(403);

    // The owning host can, and the response echoes the upserted day.
    const ok = await send("POST", `/v1/listings/${listing.id}/menu`, hostToken, payload);
    expect(ok.statusCode).toBe(201);
    const day = ok.json().day;
    expect(day.breakfast.text).toBe("Poha & chai");
    expect(day.lunch.notAvailable).toBe(true);
    expect(day.dinner.text).toBeNull();
    expect(day.notUpdated).toBe(false);
    expect(day.updatedByHostName).toBe("Menu Host");
  });

  it("a tenant reads today + tomorrow, with empty slots as not-available", async () => {
    const res = await send("GET", `/v1/listings/${listing.id}/menu?date=${anchor.toISOString()}`, tenantToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(2);

    // Day 0 (the seeded day) carries the dish, the not-available flag, and the
    // transparent last-updated info.
    const today = body.days[0];
    expect(today.notUpdated).toBe(false);
    expect(today.breakfast.text).toBe("Poha & chai");
    expect(today.lunch.notAvailable).toBe(true);
    expect(today.lunch.text).toBeNull();
    // An untouched slot is empty → the client renders "Not available today".
    expect(today.dinner.text).toBeNull();
    expect(today.dinner.notAvailable).toBe(false);
    expect(today.updatedByHostName).toBe("Menu Host");
    expect(today.updatedAt).not.toBeNull();

    // Day 1 (tomorrow) has no menu at all → the "not updated yet" empty state.
    const next = body.days[1];
    expect(next.date.slice(0, 10)).toBe(tomorrow);
    expect(next.notUpdated).toBe(true);
    expect(next.breakfast.text).toBeNull();
    expect(next.updatedByHostName).toBeNull();
    expect(next.updatedAt).toBeNull();
  });

  it("the owning host can re-read (and the upsert replaces the day)", async () => {
    // Re-write the same day with different content — upsert, not duplicate.
    const rewrite = await send("POST", `/v1/listings/${listing.id}/menu`, hostToken, {
      date: anchor.toISOString(),
      dinner: { text: "Dal, rice, sabzi" },
    });
    expect(rewrite.statusCode).toBe(201);

    const res = await send("GET", `/v1/listings/${listing.id}/menu?date=${anchor.toISOString()}`, hostToken);
    const today = res.json().days[0];
    expect(today.dinner.text).toBe("Dal, rice, sabzi");
    expect(today.breakfast.text).toBeNull(); // replaced (full-day upsert)

    // Still exactly one row for the day (unique [listingId, date]).
    const count = await prisma.mealMenu.count({ where: { listingId: listing.id } });
    expect(count).toBe(1);
  });

  it("404 for an unknown listing, 401 unauthenticated", async () => {
    const missing = await send("GET", `/v1/listings/${randomUUID()}/menu`, tenantToken);
    expect(missing.statusCode).toBe(404);

    const unauth = await send("GET", `/v1/listings/${listing.id}/menu`);
    expect(unauth.statusCode).toBe(401);
  });
});
