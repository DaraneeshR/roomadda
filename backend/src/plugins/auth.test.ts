import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { authPlugin } from "./auth.js";
import { errorHandlerPlugin } from "./error-handler.js";
import { signAccessToken } from "../lib/tokens.js";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  app.get("/admin", { preHandler: [app.authenticate, app.requireRole(UserRole.ADMIN)] }, async () => ({
    ok: true,
  }));
  app.get("/any", { preHandler: [app.authenticate] }, async (request) => ({
    role: request.user?.role,
  }));
  await app.ready();
  return app;
}

describe("auth plugin: authenticate + requireRole (default-deny)", () => {
  let app: FastifyInstance;
  let tenantToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    tenantToken = await signAccessToken({
      sub: "11111111-1111-4111-8111-111111111111",
      role: UserRole.TENANT,
    });
    adminToken = await signAccessToken({
      sub: "22222222-2222-4222-8222-222222222222",
      role: UserRole.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("401 when no token is presented", async () => {
    const res = await app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(401);
  });

  it("401 when the token is garbage", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for the wrong role (TENANT hitting an ADMIN route)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("200 for the correct role (ADMIN)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("authenticate attaches req.user", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/any",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("TENANT");
  });
});
