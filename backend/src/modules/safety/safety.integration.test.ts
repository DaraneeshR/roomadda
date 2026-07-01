import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { smsSender } from "../../lib/sms.js";
import { safetyNotifier } from "../../lib/safety-notify.js";
import { safetyRoutes } from "./safety.route.js";

/**
 * Safety flow against a live DB: trusted-contact CRUD (capped at 3) and SOS.
 * SOS is the safety-critical path — it must SMS EVERY trusted contact with the
 * user's location AND alert admin, even with no contacts / no GPS fix. We spy on
 * the SMS sender + admin notifier (object methods) to assert both fire.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("safety: trusted contacts + SOS (integration)", () => {
  let app: FastifyInstance;
  let tenant: User;
  let token: string;

  const send = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(safetyRoutes, { prefix: "/v1" });
    await app.ready();

    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Safety Tenant", role: "TENANT", isPhoneVerified: true } });
    token = await signAccessToken({ sub: tenant.id, role: "TENANT" });
  });

  afterAll(async () => {
    await prisma.trustedContact.deleteMany({ where: { userId: tenant.id } });
    await prisma.user.deleteMany({ where: { id: tenant.id } });
    await app.close();
    await prisma.$disconnect();
  });

  it("manages trusted contacts (1–3, no duplicates)", async () => {
    const empty = await send("GET", "/v1/trusted-contacts");
    expect(empty.json()).toEqual({ items: [], max: 3 });

    for (const name of ["Amma", "Appa", "Friend"]) {
      const res = await send("POST", "/v1/trusted-contacts", { name, phone: uniquePhone() });
      expect(res.statusCode).toBe(201);
    }
    // A 4th exceeds the cap.
    const fourth = await send("POST", "/v1/trusted-contacts", { name: "Extra", phone: uniquePhone() });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error.code).toBe("CONTACTS_LIMIT_REACHED");

    const list = await send("GET", "/v1/trusted-contacts");
    expect(list.json().items).toHaveLength(3);

    // Remove one → back to 2.
    const id = list.json().items[0].id as string;
    const del = await send("DELETE", `/v1/trusted-contacts/${id}`);
    expect(del.statusCode).toBe(204);
    expect((await send("GET", "/v1/trusted-contacts")).json().items).toHaveLength(2);
  });

  it("rejects a duplicate trusted-contact number", async () => {
    await prisma.trustedContact.deleteMany({ where: { userId: tenant.id } });
    const phone = uniquePhone();
    expect((await send("POST", "/v1/trusted-contacts", { name: "A", phone })).statusCode).toBe(201);
    const dup = await send("POST", "/v1/trusted-contacts", { name: "A again", phone });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("CONTACT_EXISTS");
  });

  it("SOS sends an SMS to EVERY trusted contact (with location) AND alerts admin", async () => {
    await prisma.trustedContact.deleteMany({ where: { userId: tenant.id } });
    const c1 = await prisma.trustedContact.create({ data: { userId: tenant.id, name: "Amma", phone: uniquePhone() } });
    const c2 = await prisma.trustedContact.create({ data: { userId: tenant.id, name: "Friend", phone: uniquePhone() } });

    const smsSpy = vi.spyOn(smsSender, "sendSos").mockResolvedValue();
    const adminSpy = vi.spyOn(safetyNotifier, "sosToAdmin").mockResolvedValue();
    try {
      const res = await send("POST", "/v1/sos", { lat: 12.97, lng: 77.59 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ contactsNotified: 2, adminAlerted: true });

      // SMS path hit for BOTH contacts, carrying the maps location.
      expect(smsSpy).toHaveBeenCalledTimes(2);
      const phonesSmsed = smsSpy.mock.calls.map((c) => c[0].toPhone).sort();
      expect(phonesSmsed).toEqual([c1.phone, c2.phone].sort());
      expect(smsSpy.mock.calls[0]?.[0].locationText).toContain("maps.google.com");
      expect(smsSpy.mock.calls[0]?.[0].locationText).toContain("12.97,77.59");

      // Admin alerted exactly once.
      expect(adminSpy).toHaveBeenCalledTimes(1);
      expect(adminSpy.mock.calls[0]?.[0]).toMatchObject({ contactsNotified: 2, hasLocation: true });
    } finally {
      smsSpy.mockRestore();
      adminSpy.mockRestore();
    }
  });

  it("SOS still alerts admin with NO contacts and NO GPS fix (poor connectivity safety net)", async () => {
    await prisma.trustedContact.deleteMany({ where: { userId: tenant.id } });
    const smsSpy = vi.spyOn(smsSender, "sendSos").mockResolvedValue();
    const adminSpy = vi.spyOn(safetyNotifier, "sosToAdmin").mockResolvedValue();
    try {
      const res = await send("POST", "/v1/sos", {}); // no coords
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ contactsNotified: 0, adminAlerted: true });
      expect(smsSpy).not.toHaveBeenCalled();
      expect(adminSpy).toHaveBeenCalledTimes(1);
      expect(adminSpy.mock.calls[0]?.[0]).toMatchObject({ hasLocation: false, locationText: "Location unavailable" });
    } finally {
      smsSpy.mockRestore();
      adminSpy.mockRestore();
    }
  });

  it("rejects an unauthenticated SOS", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/sos", payload: { lat: 1, lng: 1 } });
    expect(res.statusCode).toBe(401);
  });
});
