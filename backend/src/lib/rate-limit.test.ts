import { describe, it, expect } from "vitest";
import {
  acquireCooldown,
  hitFixedWindow,
  type CooldownStore,
  type FixedWindowResult,
  type FixedWindowStore,
} from "./rate-limit.js";

/** In-memory stand-in for the Redis methods the limiter uses. */
function memoryStore(): FixedWindowStore & CooldownStore {
  const counts = new Map<string, number>();
  const cooldowns = new Set<string>();
  return {
    incr(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    pexpire() {
      return Promise.resolve(1);
    },
    set(key, _value, _ex, _seconds, _nx) {
      if (cooldowns.has(key)) return Promise.resolve(null);
      cooldowns.add(key);
      return Promise.resolve("OK");
    },
  };
}

describe("hitFixedWindow (OTP per-phone rate limit: 5/hour)", () => {
  it("allows up to the limit then blocks", async () => {
    const store = memoryStore();
    const key = "otp:rl:phone:+919999999999";
    const results: FixedWindowResult[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(await hitFixedWindow(store, key, 5, 3600));
    }
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5]!.allowed).toBe(false);
    expect(results[5]!.count).toBe(6);
    expect(results[4]!.remaining).toBe(0);
  });
});

describe("acquireCooldown (30s OTP resend cooldown)", () => {
  it("acquires once, then blocks while active", async () => {
    const store = memoryStore();
    expect(await acquireCooldown(store, "otp:cd:+919999999999", 30)).toBe(true);
    expect(await acquireCooldown(store, "otp:cd:+919999999999", 30)).toBe(false);
  });
});
