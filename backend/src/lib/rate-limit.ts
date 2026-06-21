/**
 * Tiny fixed-window rate limiting + cooldown helpers over Redis. The store is
 * narrowed to the few methods we use so the logic is unit-testable with an
 * in-memory fake (no live Redis required).
 */
export interface FixedWindowStore {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

export interface CooldownStore {
  set(
    key: string,
    value: string,
    secondsToken: "EX",
    seconds: number,
    nx: "NX",
  ): Promise<"OK" | null>;
}

export interface FixedWindowResult {
  count: number;
  allowed: boolean;
  remaining: number;
}

/**
 * Increment a fixed-window counter and report whether the caller is within
 * `limit`. The window's TTL is set on the first hit so it expires cleanly.
 */
export async function hitFixedWindow(
  store: FixedWindowStore,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<FixedWindowResult> {
  const count = await store.incr(key);
  if (count === 1) {
    await store.pexpire(key, windowSeconds * 1000);
  }
  return { count, allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

/**
 * Acquire a cooldown lock. Returns true if acquired (no active cooldown),
 * false if a cooldown is already in effect.
 */
export async function acquireCooldown(
  store: CooldownStore,
  key: string,
  seconds: number,
): Promise<boolean> {
  const res = await store.set(key, "1", "EX", seconds, "NX");
  return res === "OK";
}
