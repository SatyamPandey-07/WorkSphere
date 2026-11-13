import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  SENSITIVE_RATE_LIMIT_RULES,
  SLIDING_WINDOW_LOG_LUA_SCRIPT,
  SlidingWindowRateLimiter,
  consumeSensitiveRateLimit,
  createSlidingWindowRateLimitResponse,
  executeSlidingWindowLog,
  getSlidingWindowRateLimitHeaders,
  matchSensitiveRateLimit,
} from "@/lib/rateLimit/slidingWindowRateLimiter";
import {
  MemoryRateLimitStore,
  defaultMemoryStore,
} from "@/lib/rateLimit/stores/memoryStore";
import { resetRedisScripts } from "@/lib/rateLimit/stores/redisStore";
import { rateLimitMiddleware } from "@/lib/middleware/handlers/rateLimitHandler";
import type { MiddlewareContext } from "@/lib/middleware/types";

function readLuaSource(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/rateLimit/lua/slidingWindow.lua"),
    "utf8",
  );
}

describe("Sliding window log rate limiter (#7335)", () => {
  beforeEach(() => {
    defaultMemoryStore.clearAll();
    resetRedisScripts();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Lua source", () => {
    it("keeps the TypeScript script in sync with the .lua source file", () => {
      expect(SLIDING_WINDOW_LOG_LUA_SCRIPT.trim()).toBe(readLuaSource().trim());
    });

    it("uses an atomic sorted-set sliding window", () => {
      const source = readLuaSource();
      expect(source).toContain('redis.call("ZREMRANGEBYSCORE"');
      expect(source).toContain('redis.call("ZCARD"');
      expect(source).toContain('redis.call("ZADD"');
      expect(source).toContain("PEXPIRE");
    });
  });

  describe("atomic Redis execution", () => {
    it("passes the limit, window, timestamp, member, and cost to Redis eval", async () => {
      const evalMock = jest
        .fn()
        .mockResolvedValue([1, "4", 1_700_000_060, 0, "1"]);
      const result = await executeSlidingWindowLog(
        { eval: evalMock },
        "worksphere:test",
        5,
        60_000,
        1_700_000_000_000,
        "member-1",
        1,
      );

      expect(evalMock).toHaveBeenCalledWith(
        SLIDING_WINDOW_LOG_LUA_SCRIPT,
        ["worksphere:test"],
        [5, 60_000, 1_700_000_000_000, "member-1", 1],
      );
      expect(result).toMatchObject({
        success: true,
        limit: 5,
        remaining: 4,
        reset: 1_700_000_060,
        retryAfter: 0,
        count: 1,
      });
    });

    it("returns null so callers can use the in-memory fallback if Redis fails", async () => {
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await executeSlidingWindowLog(
        { eval: jest.fn().mockRejectedValue(new Error("connection refused")) },
        "worksphere:test",
        5,
        60_000,
      );

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("strict sliding-window semantics", () => {
    it("does not leak a second burst when a fixed window would roll over", async () => {
      jest.useFakeTimers();
      const store = new MemoryRateLimitStore();
      const limiter = new SlidingWindowRateLimiter({
        limit: 2,
        windowMs: 1000,
        namespace: "boundary-test",
        store,
      });
      const start = new Date("2026-01-01T00:00:00.000Z").getTime();

      jest.setSystemTime(start);
      expect((await limiter.consume("user-1")).success).toBe(true);

      jest.setSystemTime(start + 999);
      expect((await limiter.consume("user-1")).success).toBe(true);

      jest.setSystemTime(start + 1000);
      expect((await limiter.consume("user-1")).success).toBe(true);
      expect((await limiter.consume("user-1")).success).toBe(false);

      jest.setSystemTime(start + 1999);
      expect((await limiter.consume("user-1")).success).toBe(true);
    });

    it("allows exactly the configured limit under concurrent siege", async () => {
      const limiter = new SlidingWindowRateLimiter({
        limit: 10,
        windowMs: 60_000,
        namespace: "siege-test",
        store: new MemoryRateLimitStore(),
      });

      const results = await Promise.all(
        Array.from({ length: 100 }, () => limiter.consume("attacker")),
      );

      expect(results.filter((result) => result.success)).toHaveLength(10);
      expect(results.filter((result) => !result.success)).toHaveLength(90);
    });

    it("keeps in-memory checks below the sub-millisecond target", async () => {
      const limiter = new SlidingWindowRateLimiter({
        limit: 1000,
        windowMs: 60_000,
        namespace: "overhead-test",
        store: new MemoryRateLimitStore(),
      });
      const iterations = 100;
      const started = performance.now();

      for (let i = 0; i < iterations; i++) {
        await limiter.consume("perf-user");
      }

      expect((performance.now() - started) / iterations).toBeLessThan(1);
    });
  });

  describe("sensitive route configuration", () => {
    it("matches auth, bookings, and pay route boundaries only", () => {
      expect(matchSensitiveRateLimit("/api/auth/login")?.scope).toBe("auth");
      expect(matchSensitiveRateLimit("/api/bookings")?.scope).toBe("bookings");
      expect(matchSensitiveRateLimit("/api/bookings/123")?.scope).toBe(
        "bookings",
      );
      expect(matchSensitiveRateLimit("/api/pay/solana")?.scope).toBe("pay");
      expect(matchSensitiveRateLimit("/api/author")).toBeNull();
      expect(matchSensitiveRateLimit("/api/payments")).toBeNull();
      expect(matchSensitiveRateLimit("/api/venues")).toBeNull();
    });

    it("uses the strict documented limits", () => {
      expect(SENSITIVE_RATE_LIMIT_RULES.auth.limit).toBe(30);
      expect(SENSITIVE_RATE_LIMIT_RULES.bookings.limit).toBe(10);
      expect(SENSITIVE_RATE_LIMIT_RULES.pay.limit).toBe(5);
      for (const rule of Object.values(SENSITIVE_RATE_LIMIT_RULES)) {
        expect(rule.windowMs).toBe(60_000);
      }
    });

    it("returns null for routes that are not sensitive", async () => {
      await expect(
        consumeSensitiveRateLimit("/api/venues", "user-1"),
      ).resolves.toBeNull();
    });
  });

  describe("response headers", () => {
    it("returns X-RateLimit-* and Retry-After headers", () => {
      const now = 1_700_000_000_000;
      const headers = getSlidingWindowRateLimitHeaders(
        {
          success: false,
          limit: 5,
          remaining: 0,
          reset: Math.floor(now / 1000) + 30,
          retryAfter: 30,
          identity: "user-1",
        },
        now,
      );

      expect(headers).toMatchObject({
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(now / 1000) + 30),
        "RateLimit-Limit": "5",
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": "30",
        "Retry-After": "30",
      });
    });

    it("builds a 429 response with the standard headers", async () => {
      const response = createSlidingWindowRateLimitResponse({
        success: false,
        limit: 5,
        remaining: 0,
        reset: Math.ceil(Date.now() / 1000) + 30,
        retryAfter: 30,
        identity: "user-1",
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(response.headers.get("X-RateLimit-Reset")).not.toBeNull();
      await expect(response.json()).resolves.toMatchObject({
        limit: 5,
        remaining: 0,
        retryAfter: 30,
      });
    });
  });

  describe("middleware integration", () => {
    const next = async () => NextResponse.json({ success: true });

    it("applies the strict pay limit and exposes headers", async () => {
      const ctx: MiddlewareContext = { userId: "pay-user" };

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest("http://localhost/api/pay/solana", {
          method: "POST",
        });
        const response = await rateLimitMiddleware(req, ctx, next);

        expect(response.status).toBe(200);
        expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
        expect(response.headers.get("X-RateLimit-Remaining")).toBe(
          String(4 - i),
        );
        expect(response.headers.get("X-RateLimit-Reset")).not.toBeNull();
      }

      const blocked = await rateLimitMiddleware(
        new NextRequest("http://localhost/api/pay/solana", { method: "POST" }),
        ctx,
        next,
      );

      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(blocked.headers.get("X-RateLimit-Reset")).not.toBeNull();
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
