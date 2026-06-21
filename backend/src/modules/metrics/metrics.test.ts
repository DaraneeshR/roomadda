import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { BOOKING_STATUSES, metricsSchema } from "@roomadda/shared";
import { signAccessToken } from "../../lib/tokens.js";
import { authPlugin } from "../../plugins/auth.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";

/**
 * Hoisted mocks so the route never touches a real DB/Redis. The Redis stub is
 * backed by an in-memory Map (a real read-then-write cache); the Prisma stub is
 * a set of vi.fn grouped-query methods whose call counts let us prove the 30s
 * cache spares the DB on the second hit.
 */
const { prismaMock, redisMock, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    prismaMock: {
      pgListing: { groupBy: vi.fn() },
      booking: { groupBy: vi.fn() },
      paymentTransaction: { aggregate: vi.fn() },
      kycRecord: { count: vi.fn() },
      adSlot: { count: vi.fn() },
      cashCollection: { aggregate: vi.fn() },
    },
    redisMock: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
    },
  };
});

vi.mock("../../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../../lib/redis.js", () => ({ redis: redisMock }));

// Imported AFTER the mocks are registered so the service binds to the stubs.
const { metricsRoutes } = await import("./metrics.route.js");

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

/** Total prisma query calls across all six grouped reads. */
const dbCallCount = (): number =>
  prismaMock.pgListing.groupBy.mock.calls.length +
  prismaMock.booking.groupBy.mock.calls.length +
  prismaMock.paymentTransaction.aggregate.mock.calls.length +
  prismaMock.kycRecord.count.mock.calls.length +
  prismaMock.adSlot.count.mock.calls.length +
  prismaMock.cashCollection.aggregate.mock.calls.length;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(metricsRoutes);
  await app.ready();
  return app;
}

describe("GET /metrics (admin dashboard snapshot)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let tenantToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    adminToken = await signAccessToken({ sub: ADMIN_ID, role: UserRole.ADMIN });
    tenantToken = await signAccessToken({ sub: TENANT_ID, role: UserRole.TENANT });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    prismaMock.pgListing.groupBy.mockResolvedValue([
      { status: "PUBLISHED", _count: { _all: 3 } },
      { status: "DRAFT", _count: { _all: 2 } },
    ]);
    prismaMock.booking.groupBy.mockResolvedValue([
      { status: "CONFIRMED", _count: { _all: 4 } },
      { status: "TOKEN_PENDING", _count: { _all: 1 } },
    ]);
    prismaMock.paymentTransaction.aggregate.mockResolvedValue({
      _sum: { amountPaise: 500_000 },
      _count: { _all: 5 },
    });
    prismaMock.kycRecord.count.mockResolvedValue(7);
    prismaMock.adSlot.count.mockResolvedValue(2);
    prismaMock.cashCollection.aggregate.mockResolvedValue({ _sum: { amountPaise: 123_456 } });
  });

  const getMetrics = (token: string) =>
    app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${token}` } });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(401);
    expect(dbCallCount()).toBe(0);
  });

  it("403 for a non-admin (TENANT)", async () => {
    const res = await getMetrics(tenantToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    // Authorization fails before any DB work.
    expect(dbCallCount()).toBe(0);
  });

  it("returns a stable, fully-typed shape for an ADMIN", async () => {
    const res = await getMetrics(adminToken);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(metricsSchema.safeParse(body).success).toBe(true);

    expect(body.listings).toEqual({ total: 5, published: 3 });
    expect(body.payments).toEqual({ settledCountToday: 5, settledPaiseToday: 500_000 });
    expect(body.kycPending).toBe(7);
    expect(body.adsPendingApproval).toBe(2);
    expect(body.agentCashInHandPaise).toBe(123_456);

    // Every booking status is present (0 when absent) — the shape never shifts.
    for (const status of BOOKING_STATUSES) {
      expect(typeof body.bookings[status]).toBe("number");
    }
    expect(body.bookings.CONFIRMED).toBe(4);
    expect(body.bookings.TOKEN_PENDING).toBe(1);
    expect(body.bookings.EXPIRED).toBe(0);
  });

  it("serves the second call within the TTL from cache (no extra DB round-trips)", async () => {
    const first = await getMetrics(adminToken);
    expect(first.statusCode).toBe(200);
    const callsAfterFirst = dbCallCount();
    expect(callsAfterFirst).toBe(6); // one per grouped read
    expect(redisMock.set).toHaveBeenCalledTimes(1);

    const second = await getMetrics(adminToken);
    expect(second.statusCode).toBe(200);

    // No further DB work, and we did not re-write the cache.
    expect(dbCallCount()).toBe(callsAfterFirst);
    expect(redisMock.set).toHaveBeenCalledTimes(1);
    expect(redisMock.get).toHaveBeenCalledTimes(2);

    // The cached payload is identical to the freshly-computed one.
    expect(second.json()).toEqual(first.json());
  });
});
