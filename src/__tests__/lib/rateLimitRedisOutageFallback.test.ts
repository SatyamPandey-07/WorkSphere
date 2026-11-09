/**
 * Regression tests: the sliding-window limiter used to "reconcile" its in-memory
 * fallback with Redis BEFORE knowing Redis was reachable. During an outage the
 * zadd calls failed (and were swallowed), but the local counters were deleted
 * anyway, so every request started again from zero and the limit was never
 * reached - rate limiting was effectively disabled exactly when it falls back
 * to memory.
 */

const redisState: {
  down: boolean;
  zset: { score: number; member: string }[];
  zaddFails: boolean;
} = { down: false, zset: [], zaddFails: false };

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    eval: async (_script: string, _keys: string[], args: number[] & string[]) => {
      if (redisState.down) throw new Error("ECONNREFUSED");
      const [limit, windowMs, now, member] = args as unknown as [number, number, number, string];
      redisState.zset = redisState.zset.filter((e) => e.score > now - windowMs);
      if (redisState.zset.length < limit) {
        redisState.zset.push({ score: now, member });
        return [1, limit - redisState.zset.length, Math.ceil((now + windowMs) / 1000), 0];
      }
      return [0, 0, Math.ceil((now + windowMs) / 1000), 1];
    },
    zadd: async (_key: string, entry: { score: number; member: string }) => {
      if (redisState.down || redisState.zaddFails) throw new Error("ECONNREFUSED");
      redisState.zset.push(entry);
    },
  })),
}));

import {
  SlidingWindowLimiter,
  MemoryRateLimitStore,
  resetRedisScripts,
} from "@/lib/rateLimit";

describe("SlidingWindowLimiter Redis outage fallback", () => {
  let store: MemoryRateLimitStore;
  let limiter: SlidingWindowLimiter;

  beforeEach(() => {
    redisState.down = false;
    redisState.zaddFails = false;
    redisState.zset = [];
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    resetRedisScripts();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    store = new MemoryRateLimitStore();
    limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60_000, store });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisScripts();
  });

  it("still enforces the limit while Redis is down", async () => {
    redisState.down = true;

    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push((await limiter.consume("attacker")).success);
    }

    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("keeps fallback hits locally when Redis rejects the sync", async () => {
    redisState.down = true;
    await limiter.consume("k");
    await limiter.consume("k");

    // eval answers again but zadd keeps failing: nothing may be discarded.
    redisState.down = false;
    redisState.zaddFails = true;
    await limiter.consume("k");

    expect(store.getSlidingWindowEntry("default:k")?.timestamps).toHaveLength(2);
  });

  it("folds fallback hits into Redis once it is reachable, then blocks the rest of the window", async () => {
    redisState.down = true;
    for (let i = 0; i < 5; i++) await limiter.consume("k");

    redisState.down = false;
    const afterRecovery: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      afterRecovery.push((await limiter.consume("k")).success);
    }

    // The first call after recovery is answered before the sync; every later
    // one sees the outage hits and is blocked.
    expect(afterRecovery.slice(1)).toEqual([false, false, false]);
    expect(store.getSlidingWindowEntry("default:k")).toBeUndefined();
  });

  it("does not discard counters when only inspecting a key with check()", async () => {
    redisState.down = true;
    await limiter.consume("k");
    await limiter.consume("k");

    await limiter.check("k");

    expect(store.getSlidingWindowEntry("default:k")?.timestamps).toHaveLength(2);
  });
});
