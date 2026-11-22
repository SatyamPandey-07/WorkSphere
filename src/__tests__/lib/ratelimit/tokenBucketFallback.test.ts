import {
  TokenBucketLimiter,
  getOrCreateFallbackLimiter,
  resetFallbackLimiters,
  isRecoverableRedisError,
} from "@/lib/ratelimit/tokenBucketFallback";
import { NextRequest, NextResponse } from "next/server";
import type { MiddlewareContext } from "@/lib/middleware/types";

// Mock @/lib/tokenBucketRateLimit before importing rateLimitMiddleware
jest.mock("@/lib/tokenBucketRateLimit", () => {
  const actual = jest.requireActual("@/lib/tokenBucketRateLimit");
  return {
    ...actual,
    checkTokenBucketRateLimit: jest.fn(),
  };
});

import { rateLimitMiddleware } from "@/lib/middleware/handlers/rateLimitHandler";
import { checkTokenBucketRateLimit } from "@/lib/tokenBucketRateLimit";

const mockedCheckTokenBucket = jest.mocked(checkTokenBucketRateLimit);

describe("TokenBucketLimiter Unit Tests", () => {
  beforeEach(() => {
    resetFallbackLimiters();
  });

  // 1. Initial capacity
  describe("1. Initial capacity", () => {
    it("starts with full capacity and allows requests up to capacity", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
      });

      for (let i = 0; i < 5; i++) {
        const res = limiter.consume("user-1", 1, 1000);
        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(4 - i);
        expect(res.retryAfterSeconds).toBe(0);
      }
    });

    it("rejects when initial capacity is exhausted", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 3,
        refillRatePerSecond: 1,
      });

      expect(limiter.consume("user-1", 1, 1000).allowed).toBe(true);
      expect(limiter.consume("user-1", 1, 1000).allowed).toBe(true);
      expect(limiter.consume("user-1", 1, 1000).allowed).toBe(true);

      const rejected = limiter.consume("user-1", 1, 1000);
      expect(rejected.allowed).toBe(false);
      expect(rejected.remaining).toBe(0);
      expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  // 2. Burst consumption
  describe("2. Burst consumption", () => {
    it("permits additional requests when burstAllowance is configured", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
        burstAllowance: 3, // Effective capacity = 8
      });

      expect(limiter.effectiveCapacity).toBe(8);

      for (let i = 0; i < 8; i++) {
        const res = limiter.consume("user-burst", 1, 1000);
        expect(res.allowed).toBe(true);
      }

      // Next request exceeds burst and is rejected
      const excess = limiter.consume("user-burst", 1, 1000);
      expect(excess.allowed).toBe(false);
      expect(excess.remaining).toBe(0);

      // Verify rejected request did NOT consume tokens
      const secondCheck = limiter.consume("user-burst", 1, 1000);
      expect(secondCheck.allowed).toBe(false);
      expect(secondCheck.remaining).toBe(0);
    });
  });

  // 3. Steady-state refill
  describe("3. Steady-state refill", () => {
    it("refills tokens over time at the configured rate per second", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        refillRatePerSecond: 2, // 2 tokens per second (1 token per 500ms)
      });

      // Consume all 10 tokens at t = 1000ms
      for (let i = 0; i < 10; i++) {
        limiter.consume("user-refill", 1, 1000);
      }
      expect(limiter.consume("user-refill", 1, 1000).allowed).toBe(false);

      // Advance 1500ms -> should refill 3 tokens (1.5s * 2)
      const resAfter1500ms = limiter.consume("user-refill", 1, 2500);
      expect(resAfter1500ms.allowed).toBe(true);
      expect(resAfter1500ms.remaining).toBe(2); // 3 - 1 = 2 remaining

      // Advance 10,000ms -> should cap at effectiveCapacity (10), never exceeding it
      const resFull = limiter.consume("user-refill", 1, 12500);
      expect(resFull.allowed).toBe(true);
      expect(resFull.remaining).toBe(9); // 10 - 1 = 9
    });
  });

  // 4. Retry delay
  describe("4. Retry delay", () => {
    it("calculates mathematically correct retryAfterSeconds based on deficit and refill rate", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 2,
        refillRatePerSecond: 0.5, // 1 token every 2 seconds
      });

      limiter.consume("user-retry", 1, 1000);
      limiter.consume("user-retry", 1, 1000);

      const rejected = limiter.consume("user-retry", 1, 1000);
      expect(rejected.allowed).toBe(false);
      // Deficit is 1 token / 0.5 rate = 2 seconds
      expect(rejected.retryAfterSeconds).toBe(2);
      expect(rejected.resetSeconds).toBeGreaterThanOrEqual(2);
    });

    it("ensures retryAfterSeconds is never 0 or negative for rejected requests", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 1,
        refillRatePerSecond: 100,
      });

      limiter.consume("user-fast", 1, 1000);
      const rejected = limiter.consume("user-fast", 1, 1000);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  // 5. Configuration validation
  describe("5. Configuration validation", () => {
    it("throws clear errors on non-positive or non-finite capacity", () => {
      expect(() => new TokenBucketLimiter({ capacity: 0, refillRatePerSecond: 1 })).toThrow();
      expect(() => new TokenBucketLimiter({ capacity: -5, refillRatePerSecond: 1 })).toThrow();
      expect(() => new TokenBucketLimiter({ capacity: Infinity, refillRatePerSecond: 1 })).toThrow();
      expect(() => new TokenBucketLimiter({ capacity: NaN, refillRatePerSecond: 1 })).toThrow();
    });

    it("throws clear errors on non-positive or non-finite refillRatePerSecond", () => {
      expect(() => new TokenBucketLimiter({ capacity: 5, refillRatePerSecond: 0 })).toThrow();
      expect(() => new TokenBucketLimiter({ capacity: 5, refillRatePerSecond: -2 })).toThrow();
      expect(() => new TokenBucketLimiter({ capacity: 5, refillRatePerSecond: NaN })).toThrow();
    });

    it("throws clear errors on negative burstAllowance", () => {
      expect(
        () =>
          new TokenBucketLimiter({
            capacity: 5,
            refillRatePerSecond: 1,
            burstAllowance: -1,
          }),
      ).toThrow();
    });
  });

  // 6. Monotonic clock and time safety
  describe("6. Monotonic clock and time safety", () => {
    it("handles backward time jumps safely without corrupting balance or throwing", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
      });

      limiter.consume("user-jump", 1, 5000);
      // Simulate non-monotonic clock skew (e.g. wall clock rolled back)
      const resBack = limiter.consume("user-jump", 1, 3000);
      expect(resBack.allowed).toBe(true);
      expect(resBack.remaining).toBe(3);
    });
  });

  // 7. Identity isolation
  describe("7. Identity isolation", () => {
    it("maintains strict isolation between distinct client identities", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 2,
        refillRatePerSecond: 1,
      });

      limiter.consume("client-A", 1, 1000);
      limiter.consume("client-A", 1, 1000);
      expect(limiter.consume("client-A", 1, 1000).allowed).toBe(false);

      // client-B should have full capacity
      expect(limiter.consume("client-B", 1, 1000).allowed).toBe(true);
      expect(limiter.consume("client-B", 1, 1000).allowed).toBe(true);
    });
  });

  // 8. Memory management and eviction
  describe("8. Memory management", () => {
    it("prunes idle buckets exceeding maxIdleMs", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
        maxIdleMs: 5000,
      });

      limiter.consume("client-1", 1, 1000);
      limiter.consume("client-2", 1, 2000);
      expect(limiter.size).toBe(2);

      // At t = 6500ms, client-1 is idle for 5500ms (> 5000ms), client-2 is idle for 4500ms (< 5000ms)
      const pruned = limiter.pruneExpired(6500);
      expect(pruned).toBe(1);
      expect(limiter.size).toBe(1);
    });

    it("enforces maxBuckets bound to protect against memory exhaustion", () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
        maxBuckets: 3,
      });

      limiter.consume("c-1", 1, 1000);
      limiter.consume("c-2", 1, 1000);
      limiter.consume("c-3", 1, 1000);
      expect(limiter.size).toBe(3);

      // Adding 4th client should evict oldest entry and keep size <= maxBuckets
      limiter.consume("c-4", 1, 1000);
      expect(limiter.size).toBeLessThanOrEqual(3);
    });
  });
});

describe("API Gateway Middleware Fallback Integration Tests", () => {
  beforeEach(() => {
    resetFallbackLimiters();
    jest.restoreAllMocks();
  });

  function createMockContext(userId?: string | null): MiddlewareContext {
    return {
      userId: userId ?? "test-user-ip",
    };
  }

  const mockNext = async () => {
    return NextResponse.json({ success: true });
  };

  it("activates fallback on Redis 503 error and enforces rate limit", async () => {
    // Mock checkTokenBucketRateLimit to simulate HTTP 503 from Redis
    const err503 = new Error("Upstash Redis 503 Service Unavailable");
    (err503 as any).status = 503;
    mockedCheckTokenBucket.mockRejectedValue(err503);

    const ctx = createMockContext("user-503");

    // Route /api/venues matches search tier (limit 60)
    // Make 60 requests that should be allowed under fallback
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest("http://localhost/api/venues?q=work", { method: "GET" });
      const res = await rateLimitMiddleware(req, ctx, mockNext);
      expect(res.status).toBe(200);
    }

    // 61st request should be rejected by in-memory token bucket fallback with 429
    const reqRejected = new NextRequest("http://localhost/api/venues?q=work", { method: "GET" });
    const resRejected = await rateLimitMiddleware(reqRejected, ctx, mockNext);
    expect(resRejected.status).toBe(429);

    const body = await resRejected.json();
    expect(body.error).toContain("Too many requests");
    expect(resRejected.headers.get("Retry-After")).toBeDefined();
    expect(resRejected.headers.get("RateLimit-Limit")).toBe("60");
    expect(resRejected.headers.get("RateLimit-Remaining")).toBe("0");
  });

  it("activates fallback on Redis network timeout (ETIMEDOUT)", async () => {
    const timeoutErr = new Error("connect ETIMEDOUT 10.0.0.1:6379");
    (timeoutErr as any).code = "ETIMEDOUT";
    mockedCheckTokenBucket.mockRejectedValue(timeoutErr);

    const ctx = createMockContext("user-timeout");

    // Mutations tier limit = 10
    for (let i = 0; i < 10; i++) {
      const req = new NextRequest("http://localhost/api/reviews", { method: "POST" });
      const res = await rateLimitMiddleware(req, ctx, mockNext);
      expect(res.status).toBe(200);
    }

    const reqRejected = new NextRequest("http://localhost/api/reviews", { method: "POST" });
    const resRejected = await rateLimitMiddleware(reqRejected, ctx, mockNext);
    expect(resRejected.status).toBe(429);
  });

  it("resumes normal Redis behavior when Redis recovers", async () => {
    // First request: Redis is down with 503
    const err503 = new Error("503 Service Unavailable");
    (err503 as any).status = 503;
    mockedCheckTokenBucket.mockRejectedValueOnce(err503);

    const ctx = createMockContext("user-recovery");
    const req1 = new NextRequest("http://localhost/api/venues", { method: "GET" });
    const res1 = await rateLimitMiddleware(req1, ctx, mockNext);
    expect(res1.status).toBe(200);

    // Second request: Redis recovers and returns normal rate limit result
    mockedCheckTokenBucket.mockResolvedValueOnce({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Math.floor(Date.now() / 1000) + 60,
      retryAfter: 0,
      tier: "search",
      identity: "search:user-recovery",
    });

    const req2 = new NextRequest("http://localhost/api/venues", { method: "GET" });
    const res2 = await rateLimitMiddleware(req2, ctx, mockNext);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("RateLimit-Remaining")).toBe("59");
  });
});
