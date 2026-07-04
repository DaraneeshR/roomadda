import { describe, it, expect, beforeEach, vi } from "vitest";
import { areaInsightsSchema } from "@roomadda/shared";

/**
 * Unit coverage for the area-insights service: the pure band/histogram math, and
 * the Redis cache (a second call inside the TTL must serve from cache and spare
 * the DB). Prisma + Redis are hoisted mocks so the service never touches a real
 * store; the Redis stub is a real read-then-write cache over an in-memory Map.
 */
const { prismaMock, redisMock, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    prismaMock: {
      pgListing: { count: vi.fn() },
      room: { groupBy: vi.fn() },
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

const { areaService, bandFromCounts, histogramFromCounts } = await import("./area.service.js");

/** DB round-trips across the count + all grouped rent reads. */
const dbCallCount = (): number =>
  prismaMock.pgListing.count.mock.calls.length + prismaMock.room.groupBy.mock.calls.length;

describe("area insights — pure band math", () => {
  it("returns null for no priced rooms", () => {
    expect(bandFromCounts([])).toBeNull();
    expect(bandFromCounts([{ rentPaise: 800_000, count: 0 }])).toBeNull();
  });

  it("computes min / median-typical / max / mean over an odd sample", () => {
    const band = bandFromCounts([
      { rentPaise: 1_200_000, count: 1 },
      { rentPaise: 800_000, count: 1 },
      { rentPaise: 1_000_000, count: 1 },
    ]);
    expect(band).toEqual({
      minPaise: 800_000,
      typicalPaise: 1_000_000, // median of {8k,10k,12k}
      maxPaise: 1_200_000,
      avgPaise: 1_000_000,
      roomCount: 3,
    });
  });

  it("averages the two middle rents for an even sample, weighting by count", () => {
    const band = bandFromCounts([
      { rentPaise: 800_000, count: 3 },
      { rentPaise: 1_200_000, count: 1 },
    ]);
    // Expanded: 8k,8k,8k,12k -> median = (8k+8k)/2 = 8k; mean = 36k/4 = 9k.
    expect(band).toMatchObject({ minPaise: 800_000, typicalPaise: 800_000, maxPaise: 1_200_000, avgPaise: 900_000, roomCount: 4 });
  });
});

describe("area insights — pure histogram", () => {
  it("is empty when there are no priced rooms", () => {
    expect(histogramFromCounts([])).toEqual([]);
  });

  it("collapses a single distinct rent to one column", () => {
    expect(histogramFromCounts([{ rentPaise: 800_000, count: 2 }])).toEqual([
      { fromPaise: 800_000, toPaise: 800_000, count: 2 },
    ]);
  });

  it("tiles [min,max] into bins that cover every room (max lands in the last bin)", () => {
    const bins = histogramFromCounts([{ rentPaise: 800_000, count: 1 }, { rentPaise: 1_200_000, count: 1 }], 4);
    expect(bins).toHaveLength(4);
    expect(bins[0]!.fromPaise).toBe(800_000);
    expect(bins[3]!.toPaise).toBe(1_200_000);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(2);
    expect(bins[3]!.count).toBe(1); // the max rent falls in the last column
  });
});

describe("area insights — cached snapshot", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    prismaMock.pgListing.count.mockResolvedValue(2);
    prismaMock.room.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes("sharingType")) {
        return Promise.resolve([{ sharingType: 2, monthlyRentPaise: 800_000, _count: { _all: 2 } }]);
      }
      return Promise.resolve([
        { monthlyRentPaise: 800_000, _count: { _all: 1 } },
        { monthlyRentPaise: 1_200_000, _count: { _all: 1 } },
      ]);
    });
  });

  it("returns a valid, fully-typed AreaInsights shape", async () => {
    const insights = await areaService.getInsights("Koramangala", "Bengaluru");
    expect(areaInsightsSchema.safeParse(insights).success).toBe(true);
    expect(insights.area).toBe("Koramangala");
    expect(insights.city).toBe("Bengaluru");
    expect(insights.overall).toMatchObject({ minPaise: 800_000, maxPaise: 1_200_000, roomCount: 2 });
    expect(insights.byRoomType).toEqual([
      { sharingType: 2, band: expect.objectContaining({ roomCount: 2 }) },
    ]);
  });

  it("serves the second call within the TTL from cache (no extra DB round-trips)", async () => {
    const first = await areaService.getInsights("Koramangala", "Bengaluru");
    const callsAfterFirst = dbCallCount();
    expect(callsAfterFirst).toBe(6); // 1 count + 5 grouped rent reads (overall + byType + 3 genders)
    expect(redisMock.set).toHaveBeenCalledTimes(1);

    const second = await areaService.getInsights("Koramangala", "Bengaluru");
    expect(dbCallCount()).toBe(callsAfterFirst); // no further DB work
    expect(redisMock.set).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
