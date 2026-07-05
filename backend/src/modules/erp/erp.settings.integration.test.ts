import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { authRoutes } from "../auth/auth.route.js";
import { erpRoutes } from "./erp.route.js";
import type { OrgSettings, SessionResponse, TeamListResponse, TeamMember } from "@roomadda/shared";

/**
 * ERP-5 Settings & Users (§15.7) end-to-end against a live Postgres. Proves:
 * settings get/update (company, operating modes, active FY) is audited; the active
 * FY scopes the CA pack default; and the full team-login flow — an admin adds a
 * team login (server-side, real user, forced first-login change, audited); a temp
 * password grants NO session, only a change challenge; changing it issues a session
 * and lets the team member reach an ADMIN route; the temp password then fails.
 */
const uniquePhone = () => "+9193" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const uniqueEmail = () => `team.${randomUUID().slice(0, 8)}@roomadda.test`;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("erp-5 settings & team logins (§15.7, integration)", () => {
  let app: FastifyInstance;
  let admin: User;
  let agent: User;
  let adminToken: string;
  let agentToken: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(authRoutes, { prefix: "/v1" });
    await app.register(erpRoutes, { prefix: "/v1" });
    await app.ready();

    admin = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "ERP5 Settings Admin", role: "ADMIN", isPhoneVerified: true } });
    agent = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Asha Agent", role: "AGENT", assignedCity: "Bengaluru", isPhoneVerified: true } });
    createdUserIds.push(admin.id, agent.id);
    adminToken = await signAccessToken({ sub: admin.id, role: "ADMIN" });
    agentToken = await signAccessToken({ sub: agent.id, role: "AGENT" });

    // OrgSettings is a persistent singleton — reset it so the defaults assertions
    // are deterministic across repeated runs (the get-or-create re-seeds it).
    await prisma.orgSettings.deleteMany({});
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
    // Delete team users created during the run (identified by the test email domain).
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: "@roomadda.test" } } });
    await prisma.orgSettings.deleteMany({});
    await app.close();
  });

  it("reads + updates the singleton settings (company, modes, FY) — audited", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/erp/settings", headers: auth(adminToken) });
    expect(get.statusCode).toBe(200);
    const before = (get.json() as { settings: OrgSettings }).settings;
    expect(before.availableRoles).toEqual(["ADMIN"]);
    expect(before.operatingModes).toMatchObject({ onlineBookingsEnabled: true, maintenanceMode: false });

    const put = await app.inject({
      method: "PUT",
      url: "/v1/erp/settings",
      headers: auth(adminToken),
      payload: {
        legalName: "RoomAdda Pvt Ltd",
        gstin: "29ABCDE1234F1Z5",
        financialYear: 2029,
        maintenanceMode: true,
      },
    });
    expect(put.statusCode).toBe(200);
    const after = (put.json() as { settings: OrgSettings }).settings;
    expect(after.legalName).toBe("RoomAdda Pvt Ltd");
    expect(after.gstin).toBe("29ABCDE1234F1Z5");
    expect(after.financialYear).toBe(2029);
    expect(after.operatingModes.maintenanceMode).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.settings.updated", actorId: admin.id } });
    expect(audit).not.toBeNull();
  });

  it("the active FY from settings scopes the CA pack default (no explicit FY)", async () => {
    // Settings FY was set to 2029 above; a CA pack with no financialYear uses it.
    const res = await app.inject({ method: "GET", url: "/v1/erp/ca-pack", headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("FY2029");

    // An explicit FY still overrides the settings default.
    const explicit = await app.inject({ method: "GET", url: "/v1/erp/ca-pack?financialYear=2027", headers: auth(adminToken) });
    expect(explicit.headers["content-disposition"]).toContain("FY2027");
  });

  it("adds a team login (server-side, forced first-login change) and lists it — audited", async () => {
    const email = uniqueEmail();
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/team",
      headers: auth(adminToken),
      payload: { fullName: "Meera Accountant", email, tempPassword: "Temp-Pass-123", role: "ADMIN" },
    });
    expect(res.statusCode).toBe(201);
    const member = (res.json() as { member: TeamMember }).member;
    expect(member.email).toBe(email);
    expect(member.role).toBe("ADMIN");
    expect(member.mustChangePassword).toBe(true);

    // A real user row exists with a password hash (never the raw password) + the flag.
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).not.toBeNull();
    expect(row!.passwordHash).not.toContain("Temp-Pass-123");
    expect(row!.mustChangePassword).toBe(true);
    expect(row!.phone).toBeNull(); // email-only team login

    // The roster shows the new member.
    const list = await app.inject({ method: "GET", url: "/v1/erp/team", headers: auth(adminToken) });
    const items = (list.json() as TeamListResponse).items;
    expect(items.some((m) => m.email === email)).toBe(true);

    // The creation is audited with email + role, never the password.
    const audit = await prisma.auditLog.findFirst({ where: { action: "erp.team.created", targetId: member.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit!.metadata)).not.toContain("Temp-Pass-123");

    // A duplicate email is a typed 409.
    const dup = await app.inject({
      method: "POST",
      url: "/v1/erp/team",
      headers: auth(adminToken),
      payload: { fullName: "Someone Else", email, tempPassword: "Another-Temp-1", role: "ADMIN" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("temp password grants NO session — only after the forced change can they sign in", async () => {
    const email = uniqueEmail();
    const temp = "Temp-Pass-456";
    const created = await app.inject({
      method: "POST",
      url: "/v1/erp/team",
      headers: auth(adminToken),
      payload: { fullName: "Nikhil Finance", email, tempPassword: temp, role: "ADMIN" },
    });
    const newUserId = (created.json() as { member: TeamMember }).member.id;

    // 1) Login with the temp password → change challenge, NO tokens.
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: { email, password: temp, client: "mobile" },
    });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.json()).toEqual({ mustChangePassword: true });
    expect(challenge.json().accessToken).toBeUndefined();

    // 2) Wrong password → generic 401 (no enumeration).
    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: { email, password: "not-the-temp", client: "mobile" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("PASSWORD_INVALID");

    // 3) Change the password (proving the temp) → a real session is issued.
    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      payload: { email, currentPassword: temp, newPassword: "Brand-New-Pass-9", client: "mobile" },
    });
    expect(changed.statusCode).toBe(200);
    const session = changed.json() as SessionResponse & { refreshToken: string };
    expect(session.accessToken).toBeTruthy();
    expect(session.user.id).toBe(newUserId);
    expect(session.user.phone).toBeNull();

    // The flag is cleared server-side.
    const afterChange = await prisma.user.findUnique({ where: { id: newUserId }, select: { mustChangePassword: true } });
    expect(afterChange!.mustChangePassword).toBe(false);

    // 4) The new password now logs in and issues a session directly.
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: { email, password: "Brand-New-Pass-9", client: "mobile" },
    });
    expect(login.statusCode).toBe(200);
    const loginSession = login.json() as SessionResponse;
    expect(loginSession.accessToken).toBeTruthy();

    // 5) The OLD temp password no longer works.
    const stale = await app.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: { email, password: temp, client: "mobile" },
    });
    expect(stale.statusCode).toBe(401);

    // 6) The team member's session reaches an ADMIN route.
    const settings = await app.inject({ method: "GET", url: "/v1/erp/settings", headers: auth(loginSession.accessToken) });
    expect(settings.statusCode).toBe(200);

    // The change is audited.
    const audit = await prisma.auditLog.findFirst({ where: { action: "auth.password.changed", targetId: newUserId } });
    expect(audit).not.toBeNull();
  });

  it("settings + team are ADMIN-only (an agent is denied)", async () => {
    for (const req of [
      { method: "GET" as const, url: "/v1/erp/settings" },
      { method: "GET" as const, url: "/v1/erp/team" },
      { method: "POST" as const, url: "/v1/erp/team" },
    ]) {
      const res = await app.inject({ ...req, headers: auth(agentToken), payload: {} });
      expect(res.statusCode).toBe(403);
    }
  });
});
