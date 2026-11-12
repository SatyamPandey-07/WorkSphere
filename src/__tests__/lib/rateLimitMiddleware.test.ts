/**
 * Tests for the rate limit middleware and token bucket tiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimitMiddleware } from "@/lib/middleware/handlers/rateLimitHandler";
import { resetTokenBuckets, TokenBucketLimiter } from "@/lib/tokenBucketRateLimit";
import type { MiddlewareContext } from "@/lib/middleware/types";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memStore = new Map<string, RateLimitEntry>();

function memRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = memStore.get(identifier);

  if (!entry || now >= entry.resetTime) {
    memStore.set(identifier, { count: 1, resetTime: now + windowMs });
    return true; // allowed
  }

  if (entry.count >= limit) {
    return false; // rate limited
  }

  entry.count++;
  return true;
}

describe("In-memory rate limiter legacy", () => {
  beforeEach(() => {
    memStore.clear();
  });

  it("allows first request", () => {
    expect(memRateLimit("user-1", 5, 60000)).toBe(true);
  });

  it("allows up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(memRateLimit("user-1", 5, 60000)).toBe(true);
    }
  });

  it("blocks request exceeding the limit", () => {
    for (let i = 0; i < 5; i++) {
      memRateLimit("user-1", 5, 60000);
    }
    expect(memRateLimit("user-1", 5, 60000)).toBe(false);
  });

  it("different identifiers are independent", () => {
    for (let i = 0; i < 5; i++) {
      memRateLimit("user-1", 5, 60000);
    }
    // user-2 should still be allowed
    expect(memRateLimit("user-2", 5, 60000)).toBe(true);
  });

  it("limit=1 allows first, blocks second", () => {
    expect(memRateLimit("user-3", 1, 60000)).toBe(true);
    expect(memRateLimit("user-3", 1, 60000)).toBe(false);
  });

  it("resets after window expires", () => {
    memStore.set("user-4", { count: 5, resetTime: Date.now() - 1 }); // expired
    expect(memRateLimit("user-4", 5, 60000)).toBe(true); // reset
  });
});

describe("rateLimitMiddleware (Issue #7173)", () => {
  beforeEach(() => {
    resetTokenBuckets();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  function createMockContext(userId?: string | null): MiddlewareContext {
    return {
      userId: userId ?? "test-user-ip",
    };
  }

  const mockNext = async () => {
    return NextResponse.json({ success: true });
  };

  it("bypasses OPTIONS preflight requests", async () => {
    const req = new NextRequest("http://localhost/api/venues", {
      method: "OPTIONS",
    });
    const ctx = createMockContext();
    const res = await rateLimitMiddleware(req, ctx, mockNext);

    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBeNull();
  });

  it("enforces public search tier at 60 req/min with RFC-compliant headers", async () => {
    const ctx = createMockContext("search-client-1");

    for (let i = 0; i < 60; i++) {
      const req = new NextRequest("http://localhost/api/venues", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      const res = await rateLimitMiddleware(req, ctx, mockNext);
      expect(res.status).toBe(200);
      expect(res.headers.get("RateLimit-Limit")).toBe("60");
      expect(res.headers.get("RateLimit-Remaining")).toBe(String(59 - i));
      expect(res.headers.get("RateLimit-Reset")).not.toBeNull();
      expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    }

    // 61st request should be blocked with 429
    const blockedReq = new NextRequest("http://localhost/api/venues", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    const blockedRes = await rateLimitMiddleware(blockedReq, ctx, mockNext);
    expect(blockedRes.status).toBe(429);

    // RFC-compliant headers
    expect(blockedRes.headers.get("RateLimit-Limit")).toBe("60");
    expect(blockedRes.headers.get("RateLimit-Remaining")).toBe("0");
    expect(blockedRes.headers.get("RateLimit-Reset")).not.toBeNull();
    expect(blockedRes.headers.get("Retry-After")).not.toBeNull();

    // Structured JSON response
    const json = await blockedRes.json();
    expect(json.error).toBe("Too many requests. Please slow down and try again.");
    expect(json.limit).toBe(60);
    expect(json.remaining).toBe(0);
    expect(json.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("enforces auth & CSRF issuance tier at 30 req/min", async () => {
    const ctx = createMockContext("auth-client-1");

    for (let i = 0; i < 30; i++) {
      const req = new NextRequest("http://localhost/api/auth/csrf-token", {
        headers: { "x-forwarded-for": "10.0.0.2" },
      });
      const res = await rateLimitMiddleware(req, ctx, mockNext);
      expect(res.status).toBe(200);
      expect(res.headers.get("RateLimit-Limit")).toBe("30");
      expect(res.headers.get("RateLimit-Remaining")).toBe(String(29 - i));
    }

    // 31st request should be blocked
    const blockedReq = new NextRequest("http://localhost/api/auth/csrf-token", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    const blockedRes = await rateLimitMiddleware(blockedReq, ctx, mockNext);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("RateLimit-Limit")).toBe("30");
    expect(blockedRes.headers.get("RateLimit-Remaining")).toBe("0");
  });

  it("enforces mutating actions tier (bookings, reviews) at 10 req/min", async () => {
    const ctx = createMockContext("mutations-client-1");

    for (let i = 0; i < 10; i++) {
      const req = new NextRequest("http://localhost/api/bookings", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.3" },
      });
      const res = await rateLimitMiddleware(req, ctx, mockNext);
      expect(res.status).toBe(200);
      expect(res.headers.get("RateLimit-Limit")).toBe("10");
      expect(res.headers.get("RateLimit-Remaining")).toBe(String(9 - i));
    }

    // 11th request is blocked
    const blockedReq = new NextRequest("http://localhost/api/bookings", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.3" },
    });
    const blockedRes = await rateLimitMiddleware(blockedReq, ctx, mockNext);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("RateLimit-Limit")).toBe("10");
    expect(blockedRes.headers.get("RateLimit-Remaining")).toBe("0");

    const json = await blockedRes.json();
    expect(json.limit).toBe(10);
    expect(json.remaining).toBe(0);
    expect(json.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("gracefully fails open when rate limit resolution encounters errors or timeouts", async () => {
    const ctx = createMockContext("error-client-1");
    const req = new NextRequest("http://localhost/api/venues", {
      headers: { "x-forwarded-for": "10.0.0.4" },
    });

    const spy = jest
      .spyOn(TokenBucketLimiter.prototype, "consume")
      .mockRejectedValueOnce(new Error("Connection timeout to Redis cluster"));

    const res = await rateLimitMiddleware(req, ctx, mockNext);
    // Should fail-open and allow the request through
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    spy.mockRestore();
  });
});
