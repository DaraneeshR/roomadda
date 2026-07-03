/**
 * "Viewing now" presence — distinct active sessions per listing, over Redis.
 *
 * A per-listing sorted set holds `sessionKey -> lastHeartbeatMs`. Because the
 * member is the session key, a re-heartbeat from the SAME session UPDATES its
 * score instead of adding a row — so we count distinct sessions, NEVER refreshes
 * (see the honesty requirement in /CLAUDE.md). "Active now" = members whose last
 * heartbeat is within the TTL window; stale members are pruned by score on read,
 * and the whole key self-expires shortly after the last heartbeat so idle
 * listings leave nothing behind.
 *
 * The Redis surface is narrowed to the few commands used so the store is
 * unit-testable with an in-memory fake (no live Redis required), mirroring
 * lib/rate-limit.ts.
 */
export interface PresenceRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

export interface PresenceStore {
  /** Record that `sessionKey` is viewing `listingId` at `nowMs`. */
  heartbeat(listingId: string, sessionKey: string, nowMs: number, ttlSeconds: number): Promise<void>;
  /** Count distinct sessions active within the TTL window as of `nowMs`. */
  countActive(listingId: string, nowMs: number, ttlSeconds: number): Promise<number>;
}

const keyFor = (listingId: string): string => `social:viewing:${listingId}`;

export function createRedisPresenceStore(redis: PresenceRedis): PresenceStore {
  return {
    async heartbeat(listingId, sessionKey, nowMs, ttlSeconds) {
      const key = keyFor(listingId);
      await redis.zadd(key, nowMs, sessionKey);
      // Self-clean: keep the key a little past the TTL beyond the last heartbeat
      // so an abandoned listing's set disappears on its own.
      await redis.pexpire(key, ttlSeconds * 1000 * 2);
    },

    async countActive(listingId, nowMs, ttlSeconds) {
      const key = keyFor(listingId);
      const cutoff = nowMs - ttlSeconds * 1000;
      // Drop sessions whose last heartbeat is older than the window, then count
      // what remains — the genuine number of distinct sessions viewing now.
      await redis.zremrangebyscore(key, 0, cutoff);
      return redis.zcard(key);
    },
  };
}
