import {
  executeAtomicTokenBucket,
  executeAtomicSlidingWindow,
  ATOMIC_TOKEN_BUCKET_LUA_SCRIPT,
  ATOMIC_SLIDING_WINDOW_LUA_SCRIPT,
  microTimestampMember,
} from "@/lib/rateLimit/stores/redisStore";
import { TokenBucketLimiter } from "@/lib/rateLimit/limiters/tokenBucketLimiter";
import { SlidingWindowLimiter } from "@/lib/rateLimit/limiters/slidingWindowLimiter";
import { defaultMemoryStore } from "@/lib/rateLimit/stores/memoryStore";

describe("Atomic Distributed Token Bucket & Sliding Window Limiter (#4127)", () => {
  beforeEach(() => {
    defaultMemoryStore.clearAll();
  });

  describe("Lua Script Constants", () => {
    it("defines valid non-empty Lua script templates", () => {
      expect(ATOMIC_TOKEN_BUCKET_LUA_SCRIPT).toBeDefined();
      expect(ATOMIC_TOKEN_BUCKET_LUA_SCRIPT).toContain("redis.call(\"HMGET\"");

      expect(ATOMIC_SLIDING_WINDOW_LUA_SCRIPT).toBeDefined();
      expect(ATOMIC_SLIDING_WINDOW_LUA_SCRIPT).toContain("redis.call(\"ZREMRANGEBYSCORE\"");
    });
  });

  describe("executeAtomicTokenBucket Mock Redis Integration", () => {
    it("executes atomic token deduction with mock Redis eval", async () => {
      let currentTokens = 10;
      let lastRefill = Date.now();

      const mockRedis = {
        eval: jest.fn(async (_script, _keys, args) => {
          const maxTokens = Number(args[0]);
          const windowMs = Number(args[1]);
          const cost = Number(args[2]);
          const now = Number(args[3]);

          const elapsed = Math.max(0, now - lastRefill);
          if (elapsed > 0) {
            const refill = (elapsed / windowMs) * maxTokens;
            currentTokens = Math.min(maxTokens, currentTokens + refill);
            lastRefill = now;
          }

          if (currentTokens >= cost) {
            currentTokens -= cost;
            return [1, Math.floor(currentTokens), Math.ceil((now + windowMs) / 1000), 0, String(currentTokens)];
          } else {
            return [0, Math.floor(currentTokens), Math.ceil((now + windowMs) / 1000), 1, String(currentTokens)];
          }
        }),
      };

      const key = "test:atomic:tokenbucket";
      const res1 = await executeAtomicTokenBucket(mockRedis, key, 10, 60000, 1);

      expect(res1).not.toBeNull();
      expect(res1?.success).toBe(true);
      expect(res1?.remaining).toBe(9);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it("returns null gracefully if Redis eval fails", async () => {
      const mockRedis = {
        eval: jest.fn().mockRejectedValue(new Error("Redis connection refused")),
      };

      const res = await executeAtomicTokenBucket(mockRedis, "test:key", 10, 60000);
      expect(res).toBeNull();
    });
  });

  describe("executeAtomicSlidingWindow Mock Redis Integration", () => {
    it("executes atomic sliding window check and addition with mock Redis eval", async () => {
      const zset = new Map<string, number>();

      const mockRedis = {
        eval: jest.fn(async (_script, _keys, args) => {
          const limit = Number(args[0]);
          const windowMs = Number(args[1]);
          const now = Number(args[2]);
          const member = String(args[3]);

          const windowStart = now - windowMs;
          for (const [m, score] of zset.entries()) {
            if (score <= windowStart) zset.delete(m);
          }

          if (zset.size < limit) {
            zset.set(member, now);
            return [1, limit - zset.size, Math.ceil((now + windowMs) / 1000), 0];
          } else {
            return [0, 0, Math.ceil((now + windowMs) / 1000), 1];
          }
        }),
      };

      const key = "test:atomic:sliding";
      const res1 = await executeAtomicSlidingWindow(mockRedis, key, 5, 60000);

      expect(res1).not.toBeNull();
      expect(res1?.success).toBe(true);
      expect(res1?.remaining).toBe(4);
    });
  });

  describe("Concurrency Stress Test (Simulated High Throughput)", () => {
    it("handles 50 concurrent requests cleanly without over-allocating tokens", async () => {
      const limiter = new TokenBucketLimiter({
        limit: 10,
        windowMs: 60000,
        name: "stress-test",
      });

      const identifier = "concurrent-user-999";

      // Fire 50 requests in parallel
      const promises = Array.from({ length: 50 }, () =>
        limiter.consume(identifier)
      );

      const results = await Promise.all(promises);

      const allowedCount = results.filter((r) => r.success).length;
      const blockedCount = results.filter((r) => !r.success).length;

      // Exactly 10 should be allowed, 40 should be blocked
      expect(allowedCount).toBe(10);
      expect(blockedCount).toBe(40);
    });

    it("handles concurrent sliding window requests cleanly", async () => {
      const limiter = new SlidingWindowLimiter({
        limit: 15,
        windowMs: 60000,
        namespace: "sliding-stress",
      });

      const identifier = "sliding-user-888";

      const promises = Array.from({ length: 40 }, () =>
        limiter.consume(identifier)
      );

      const results = await Promise.all(promises);

      const allowedCount = results.filter((r) => r.success).length;
      const blockedCount = results.filter((r) => !r.success).length;

      expect(allowedCount).toBe(15);
      expect(blockedCount).toBe(25);
    });
  });

  describe("microTimestampMember Utility", () => {
    it("formats microsecond timestamp member strings deterministically", () => {
      const member = microTimestampMember(1700000000, 12345, "nonce123");
      expect(member).toBe("1700000000012345:nonce123");
    });
  });

  describe("SlidingWindowLimiter Reset Timestamps in Epoch Seconds (#4289)", () => {
    it("returns reset timestamp in seconds on consume and check", async () => {
      const limiter = new SlidingWindowLimiter({
        limit: 2,
        windowMs: 60000,
        namespace: "sliding-reset",
      });

      const nowSec = Math.floor(Date.now() / 1000);

      // Check empty state
      const checkRes1 = await limiter.check("user-1");
      expect(checkRes1.reset).toBeGreaterThanOrEqual(nowSec);
      expect(checkRes1.reset).toBeLessThan(nowSec + 120);

      // Consume 1
      const consumeRes1 = await limiter.consume("user-1");
      expect(consumeRes1.success).toBe(true);
      expect(consumeRes1.reset).toBeGreaterThanOrEqual(nowSec);
      expect(consumeRes1.reset).toBeLessThan(nowSec + 120);

      // Consume 2
      const consumeRes2 = await limiter.consume("user-1");
      expect(consumeRes2.success).toBe(true);
      expect(consumeRes2.reset).toBeGreaterThanOrEqual(nowSec);

      // Consume 3 (depleted)
      const consumeRes3 = await limiter.consume("user-1");
      expect(consumeRes3.success).toBe(false);
      expect(consumeRes3.reset).toBeGreaterThanOrEqual(nowSec);
      expect(consumeRes3.reset).toBeLessThan(nowSec + 120);
      expect(consumeRes3.retryAfter).toBeGreaterThanOrEqual(1);

      // Check depleted
      const checkRes2 = await limiter.check("user-1");
      expect(checkRes2.success).toBe(false);
      expect(checkRes2.reset).toBeGreaterThanOrEqual(nowSec);
      expect(checkRes2.reset).toBeLessThan(nowSec + 120);
    });
  });
  describe("Unified Rate Limiting Robustness & Export Validation (#6816)", () => {
    it("exports MemoryRateLimitStore, SlidingWindowLimiter, and TokenBucketLimiter from @/lib/rateLimit", async () => {
      const rl = await import("@/lib/rateLimit");
      expect(typeof rl.MemoryRateLimitStore).toBe("function");
      expect(typeof rl.SlidingWindowLimiter).toBe("function");
      expect(typeof rl.TokenBucketLimiter).toBe("function");
    });

    it("sanitizes invalid limits and non-positive window durations in TokenBucketLimiter", async () => {
      const badLimiter = new TokenBucketLimiter({
        limit: -5 as any,
        windowMs: NaN as any,
        name: "bad-options",
      });

      expect(badLimiter.limit).toBe(10);
      expect(badLimiter.windowMs).toBe(60000);

      const res = await badLimiter.consume("user-bad", -10);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(9);
    });

    it("heals and rejects NaN tokens in MemoryRateLimitStore", () => {
      const store = new defaultMemoryStore.constructor();
      store.setTokenBucketEntry("corrupt-key", {
        tokens: NaN,
        lastRefill: Date.now(),
      });

      expect(store.getTokenBucketEntry("corrupt-key")).toBeUndefined();
    });

    it("sanitizes negative and non-finite arguments in executeAtomicTokenBucket", async () => {
      const mockRedis = {
        eval: jest.fn(async () => [1, 9, 100, 0]),
      };

      await executeAtomicTokenBucket(mockRedis, "safe-eval-key", -5, NaN, -2);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ["safe-eval-key"],
        [10, 60000, 1, expect.any(Number)]
      );
    });
  });
});
