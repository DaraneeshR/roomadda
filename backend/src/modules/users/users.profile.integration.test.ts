import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/tokens.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { authPlugin } from "../../plugins/auth.js";
import { userRoutes } from "./users.route.js";

/**
 * Self-service profile: PATCH /v1/me edits ONLY the caller's own row (no :id),
 * `gender` round-trips to the user themselves, and identity fields can't be
 * escalated through it.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

describe("profile self-service (integration)", () => {
  let app: FastifyInstance;
  let alice: User;
  let bob: User;
  let aliceToken: string;
  let bobToken: string;

  async function patchMe(token: string, body: unknown) {
    return app.inject({ method: "PATCH", url: "/v1/me", headers: { authorization: `Bearer ${token}` }, payload: body as object });
  }
  async function getMe(token: string) {
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${token}` } });
    return res.json().user as Record<string, unknown>;
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    await app.register(userRoutes, { prefix: "/v1" });
    await app.ready();

    alice = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Alice", role: "TENANT", isPhoneVerified: true } });
    bob = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Bob", role: "TENANT", isPhoneVerified: true } });
    aliceToken = await signAccessToken({ sub: alice.id, role: "TENANT" });
    bobToken = await signAccessToken({ sub: bob.id, role: "TENANT" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("starts with empty profile fields", async () => {
    const me = await getMe(aliceToken);
    expect(me.gender).toBeNull();
    expect(me.occupationType).toBeNull();
    expect(me.college).toBeNull();
  });

  it("updates the caller's own profile and returns gender to the user themselves", async () => {
    const res = await patchMe(aliceToken, {
      fullName: "Alice A",
      gender: "FEMALE",
      dateOfBirth: "2000-05-01",
      occupationType: "STUDENT",
      college: "Christ University",
    });
    expect(res.statusCode).toBe(200);
    const user = res.json().user;
    expect(user.fullName).toBe("Alice A");
    expect(user.gender).toBe("FEMALE");
    expect(user.occupationType).toBe("STUDENT");
    expect(user.college).toBe("Christ University");
    expect(typeof user.dateOfBirth).toBe("string");

    const me = await getMe(aliceToken);
    expect(me.gender).toBe("FEMALE");
  });

  it("is self-scoped — editing as Bob never touches Alice", async () => {
    await patchMe(bobToken, { college: "Bob College" });
    const bobMe = await getMe(bobToken);
    const aliceMe = await getMe(aliceToken);
    expect(bobMe.college).toBe("Bob College");
    expect(aliceMe.college).toBe("Christ University"); // unchanged
  });

  it("rejects an empty patch and unknown/identity keys (no role escalation)", async () => {
    expect((await patchMe(aliceToken, {})).statusCode).toBe(400);
    expect((await patchMe(aliceToken, { role: "ADMIN" })).statusCode).toBe(400);
    const me = await getMe(aliceToken);
    expect(me.role).toBe("TENANT"); // unchanged
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "PATCH", url: "/v1/me", payload: { fullName: "x" } });
    expect(res.statusCode).toBe(401);
  });
});
