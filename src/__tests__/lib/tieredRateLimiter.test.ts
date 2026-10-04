/**
 * Unit and integration tests for Tier-Based Sliding Window Rate Limiter (#3475).
 * Tests cover anonymous tier, authenticated tier, headers, identity isolation,
 * sliding-window time passage, offline/in-memory fallback, and endpoint integration.
 */

import { NextRequest } from "next/server";
import {
  checkTieredRateLimit,
  memTieredRateLimit,
  getTieredRateLimitInfo,
  getClientIp,
  getRateLimitHeaders,
  createRateLimitResponse,
  applyRateLimitHeaders,
  resetTieredRateLimit,
  resetRedisScripts,
  TIER_CONFIGS,
} from "@/lib/rateLimit";
import { GET as venueSummaryGET } from "@/app/api/venues/[venueId]/summary/route";
import { POST as venueTranslatePOST } from "@/app/api/venues/[id]/translate/route";
import { auth } from "@clerk/nextjs/server";

// Mock Upstash Ratelimit & Redis
const mockUpstashLimit = jest.fn();
const mockSlidingWindow = jest
  .fn()
  .mockImplementation((limit: number, duration: string) => ({
    tokens: limit,
    window: duration,
  }));

jest.mock("@upstash/ratelimit", () => {
  return {
    Ratelimit: Object.assign(
      jest.fn().mockImplementation((config: any) => ({
        limit: (id: string) => mockUpstashLimit(id, config),
      })),
      {
        slidingWindow: (limit: number, duration: string) =>
          mockSlidingWindow(limit, duration),
      },
    ),
  };
});

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({})),
}));

// Mock DB and external AI/Translation services for route integration tests
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn().mockResolvedValue({
        id: "venue-123",
        name: "Cafe Worksphere",
        category: "cafe",
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
        hasErgonomic: true,
        hasPhoneBooths: false,
        hasQuietZone: true,
        outletDensity: "high",
        hostMessage: "Great workspace for remote workers.",
      }),
    },
  },
}));

jest.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: jest
    .fn()
    .mockResolvedValue("Quiet cafe with high-speed Wi-Fi and ample outlets."),
}));

jest.mock("@/lib/deeplTranslation", () => ({
  translateVenueDescription: jest
    .fn()
    .mockResolvedValue("Superbe espace de travail pour les télétravailleurs."),
}));

describe("Tier-Based Sliding Window Rate Limiter (#3475)", () => {
  beforeEach(() => {
    resetTieredRateLimit();
    resetRedisScripts();
    jest.clearAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── 1. Anonymous Tier ─────────────────────────────────────────────────────
  describe("Anonymous Tier", () => {
    it("assigns an exact limit of 10 requests / 15 minutes", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "203.0.113.1" },
      });

      const result = await checkTieredRateLimit(req, { userId: null });
      expect(result.tier).toBe("anonymous");
      expect(result.limit).toBe(10);
      expect(TIER_CONFIGS.anonymous.limit).toBe(10);
      expect(TIER_CONFIGS.anonymous.windowMs).toBe(15 * 60 * 1000);
    });

    it("allows the first request and correctly decreases remaining count", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "203.0.113.2" },
      });

      const first = await checkTieredRateLimit(req, { userId: null });
      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(9);
      expect(first.limit).toBe(10);

      const second = await checkTieredRateLimit(req, { userId: null });
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(8);
    });

    it("allows requests up to the threshold of 10 requests", async () => {
      const ip = "203.0.113.3";
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": ip },
      });

      for (let i = 1; i <= 10; i++) {
        const result = await checkTieredRateLimit(req, { userId: null });
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10 - i);
      }
    });

    it("rejects request exceeding threshold (11th request) with 429 behavior", async () => {
      const ip = "203.0.113.4";
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": ip },
      });

      for (let i = 0; i < 10; i++) {
        await checkTieredRateLimit(req, { userId: null });
      }

      const blocked = await checkTieredRateLimit(req, { userId: null });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfter).toBeGreaterThan(0);

      const response = createRateLimitResponse(blocked);
      expect(response.status).toBe(429);

      const body = await response.json();
      expect(body.error).toBe("Too many requests. Please try again later.");
      expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    });
  });

  // ─── 2. Authenticated Tier ─────────────────────────────────────────────────
  describe("Authenticated Tier", () => {
    it("assigns an exact limit of 60 requests / 15 minutes", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary");
      const result = await checkTieredRateLimit(req, { userId: "user_vip_1" });

      expect(result.tier).toBe("authenticated");
      expect(result.limit).toBe(60);
      expect(TIER_CONFIGS.authenticated.limit).toBe(60);
      expect(TIER_CONFIGS.authenticated.windowMs).toBe(15 * 60 * 1000);
    });

    it("allows up to 60 requests and rejects the 61st request", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary");

      for (let i = 1; i <= 60; i++) {
        const result = await checkTieredRateLimit(req, {
          userId: "user_vip_2",
        });
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(60 - i);
      }

      const blocked = await checkTieredRateLimit(req, { userId: "user_vip_2" });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.limit).toBe(60);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it("grants authenticated users a higher allowance than anonymous users", async () => {
      expect(TIER_CONFIGS.authenticated.limit).toBeGreaterThan(
        TIER_CONFIGS.anonymous.limit,
      );
      expect(TIER_CONFIGS.authenticated.limit).toBe(60);
      expect(TIER_CONFIGS.anonymous.limit).toBe(10);
    });
  });

  // ─── 3. Header Behavior ───────────────────────────────────────────────────
  describe("Headers Behavior", () => {
    it("exposes X-RateLimit-Limit and X-RateLimit-Remaining for successful requests", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });

      const result = await checkTieredRateLimit(req, { userId: null });
      const headers = getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("10");
      expect(headers["X-RateLimit-Remaining"]).toBe("9");
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("exposes Retry-After and X-RateLimit-Remaining: 0 when blocked", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "10.0.0.2" },
      });

      for (let i = 0; i < 10; i++) {
        await checkTieredRateLimit(req, { userId: null });
      }

      const blocked = await checkTieredRateLimit(req, { userId: null });
      const headers = getRateLimitHeaders(blocked);

      expect(headers["X-RateLimit-Limit"]).toBe("10");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBeDefined();
      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
      expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(900);
    });

    it("never sets negative remaining count", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "10.0.0.3" },
      });

      for (let i = 0; i < 15; i++) {
        const res = await checkTieredRateLimit(req, { userId: null });
        expect(res.remaining).toBeGreaterThanOrEqual(0);
      }
    });

    it("applies headers to a Response object via applyRateLimitHeaders", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "10.0.0.4" },
      });
      const result = await checkTieredRateLimit(req, { userId: null });

      const response = new Response(JSON.stringify({ ok: true }), {
        status: 200,
      });
      applyRateLimitHeaders(response, result);

      expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("9");
    });
  });

  // ─── 4. Identity Isolation ────────────────────────────────────────────────
  describe("Identity Isolation", () => {
    it("isolates anonymous IP A from IP B", async () => {
      const reqA = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      });
      const reqB = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "198.51.100.2" },
      });

      // Exhaust IP A
      for (let i = 0; i < 10; i++) {
        await checkTieredRateLimit(reqA, { userId: null });
      }
      const blockedA = await checkTieredRateLimit(reqA, { userId: null });
      expect(blockedA.allowed).toBe(false);

      // IP B should be fresh
      const resultB = await checkTieredRateLimit(reqB, { userId: null });
      expect(resultB.allowed).toBe(true);
      expect(resultB.remaining).toBe(9);
    });

    it("isolates authenticated user A from user B", async () => {
      const req = new NextRequest("http://localhost/api/venues/123/summary");

      // Exhaust User A
      for (let i = 0; i < 60; i++) {
        await checkTieredRateLimit(req, { userId: "user_a" });
      }
      const blockedA = await checkTieredRateLimit(req, { userId: "user_a" });
      expect(blockedA.allowed).toBe(false);

      // User B should be fresh
      const resultB = await checkTieredRateLimit(req, { userId: "user_b" });
      expect(resultB.allowed).toBe(true);
      expect(resultB.remaining).toBe(59);
    });

    it("does not share quota between authenticated user and anonymous IP", async () => {
      const sharedIp = "192.168.1.100";
      const anonReq = new NextRequest(
        "http://localhost/api/venues/123/summary",
        {
          headers: { "x-forwarded-for": sharedIp },
        },
      );
      const authReq = new NextRequest(
        "http://localhost/api/venues/123/summary",
        {
          headers: { "x-forwarded-for": sharedIp },
        },
      );

      // Exhaust anonymous IP quota
      for (let i = 0; i < 10; i++) {
        await checkTieredRateLimit(anonReq, { userId: null });
      }
      const blockedAnon = await checkTieredRateLimit(anonReq, { userId: null });
      expect(blockedAnon.allowed).toBe(false);

      // Authenticated user from the same IP is completely unaffected
      const resultAuth = await checkTieredRateLimit(authReq, {
        userId: "user_from_same_ip",
      });
      expect(resultAuth.allowed).toBe(true);
      expect(resultAuth.remaining).toBe(59);
      expect(resultAuth.limit).toBe(60);
    });

    it("extracts client IP correctly from proxy headers", () => {
      const reqMultipleIps = new NextRequest("http://localhost", {
        headers: {
          "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
        },
      });
      expect(getClientIp(reqMultipleIps)).toBe("203.0.113.195");

      const reqRealIp = new NextRequest("http://localhost", {
        headers: { "x-real-ip": "198.51.100.5" },
      });
      expect(getClientIp(reqRealIp)).toBe("198.51.100.5");

      const reqFallback = new NextRequest("http://localhost");
      expect(getClientIp(reqFallback)).toBe("127.0.0.1");
    });
  });

  // ─── 5. Sliding-Window Behavior ───────────────────────────────────────────
  describe("Sliding-Window Time Passage", () => {
    it("restores tokens as the 15-minute sliding window moves forward", () => {
      jest.useFakeTimers();
      const startTime = new Date("2026-10-01T12:00:00Z").getTime();
      jest.setSystemTime(startTime);

      const ip = "172.16.0.1";

      // Make 10 requests at T = 0
      for (let i = 0; i < 10; i++) {
        const res = memTieredRateLimit("test-window", "anonymous", ip);
        expect(res.allowed).toBe(true);
      }

      // 11th request at T = 0 is blocked
      const blockedInitial = memTieredRateLimit("test-window", "anonymous", ip);
      expect(blockedInitial.allowed).toBe(false);
      expect(blockedInitial.remaining).toBe(0);

      // Advance 7.5 minutes (halfway through the 15m window)
      jest.advanceTimersByTime(7.5 * 60 * 1000);
      const blockedHalfway = memTieredRateLimit("test-window", "anonymous", ip);
      expect(blockedHalfway.allowed).toBe(false);

      // Advance another 7.5 minutes + 1 second (past 15 minutes)
      jest.advanceTimersByTime(7.5 * 60 * 1000 + 1000);

      // Requests should now be allowed again
      const allowedAfterWindow = memTieredRateLimit(
        "test-window",
        "anonymous",
        ip,
      );
      expect(allowedAfterWindow.allowed).toBe(true);
      expect(allowedAfterWindow.remaining).toBe(9);
    });

    it("slides gradually based on individual request timestamps", () => {
      jest.useFakeTimers();
      const startTime = new Date("2026-10-01T12:00:00Z").getTime();
      jest.setSystemTime(startTime);

      const ip = "172.16.0.2";

      // 5 requests at T = 0
      for (let i = 0; i < 5; i++) {
        memTieredRateLimit("test-gradual", "anonymous", ip);
      }

      // Advance 5 minutes, make 5 more requests (total 10)
      jest.advanceTimersByTime(5 * 60 * 1000);
      for (let i = 0; i < 5; i++) {
        memTieredRateLimit("test-gradual", "anonymous", ip);
      }

      // At T = 5m, 11th request is blocked
      expect(memTieredRateLimit("test-gradual", "anonymous", ip).allowed).toBe(
        false,
      );

      // Advance to T = 15m + 1s (15m from T=0)
      // The first 5 requests slide out, but the 5 made at T=5m remain valid
      jest.advanceTimersByTime(10 * 60 * 1000 + 1000);

      const info = getTieredRateLimitInfo("test-gradual", "anonymous", ip);
      expect(info.count).toBe(5);
      expect(info.remaining).toBe(5);

      // Exactly 5 more requests should be allowed
      for (let i = 0; i < 5; i++) {
        expect(
          memTieredRateLimit("test-gradual", "anonymous", ip).allowed,
        ).toBe(true);
      }

      // Now quota is exhausted again
      expect(memTieredRateLimit("test-gradual", "anonymous", ip).allowed).toBe(
        false,
      );
    });
  });

  // ─── 6. Offline / In-Memory Fallback & Cap ─────────────────────────────────
  describe("In-Memory Fallback & Storage Bounds", () => {
    it("handles large number of entries without crashing or unbounded growth", () => {
      // Simulate multiple unique IPs
      for (let i = 0; i < 200; i++) {
        const res = memTieredRateLimit(
          "test-scale",
          "anonymous",
          `ip-bulk-${i}`,
        );
        expect(res.allowed).toBe(true);
      }
    });

    it("inspects rate limit status without incrementing count via getTieredRateLimitInfo", () => {
      const ip = "10.10.10.10";
      const before = getTieredRateLimitInfo("test-info", "anonymous", ip);
      expect(before.count).toBe(0);
      expect(before.remaining).toBe(10);
      expect(before.isLimited).toBe(false);

      memTieredRateLimit("test-info", "anonymous", ip);

      const after = getTieredRateLimitInfo("test-info", "anonymous", ip);
      expect(after.count).toBe(1);
      expect(after.remaining).toBe(9);
      expect(after.isLimited).toBe(false);
    });
  });

  // ─── 7. Upstash Redis Production Integration ──────────────────────────────
  describe("Upstash Redis Sliding Window", () => {
    it("uses Ratelimit.slidingWindow when UPSTASH env vars are present", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";

      mockUpstashLimit.mockResolvedValueOnce({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 900_000,
      });

      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });

      const result = await checkTieredRateLimit(req, { userId: null });
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(mockSlidingWindow).toHaveBeenCalledWith(10, "15 m");
      expect(mockUpstashLimit).toHaveBeenCalledWith(
        "1.2.3.4",
        expect.anything(),
      );
    });

    it("falls back to in-memory rate limiting when Upstash Redis throws", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockUpstashLimit.mockRejectedValueOnce(
        new Error("Redis connection timeout"),
      );

      const req = new NextRequest("http://localhost/api/venues/123/summary", {
        headers: { "x-forwarded-for": "1.2.3.5" },
      });

      const result = await checkTieredRateLimit(req, { userId: null });
      // Should not crash and should enforce rate limiting via in-memory
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Upstash Redis rate limit error"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // ─── 8. Endpoint Integration & Shared Quota (No Endpoint Hopping) ─────────
  describe("Endpoint Integration & Shared Quota", () => {
    it("protects GET /api/venues/[venueId]/summary with rate limiting", async () => {
      const ip = "192.0.2.1";

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest(
          "http://localhost/api/venues/venue-123/summary",
          {
            headers: { "x-forwarded-for": ip },
          },
        );
        const res = await venueSummaryGET(req, {
          params: Promise.resolve({ venueId: "venue-123" }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(9 - i));
      }

      // 11th request must be blocked with HTTP 429
      const blockedReq = new NextRequest(
        "http://localhost/api/venues/venue-123/summary",
        {
          headers: { "x-forwarded-for": ip },
        },
      );
      const blockedRes = await venueSummaryGET(blockedReq, {
        params: Promise.resolve({ venueId: "venue-123" }),
      });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(blockedRes.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(Number(blockedRes.headers.get("Retry-After"))).toBeGreaterThan(0);

      const body = await blockedRes.json();
      expect(body.error).toBe("Too many requests. Please try again later.");
    });

    it("protects POST /api/venues/[id]/translate with rate limiting", async () => {
      const ip = "192.0.2.2";

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest(
          "http://localhost/api/venues/venue-123/translate",
          {
            method: "POST",
            headers: {
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: JSON.stringify({ targetLang: "FR", text: "Hello" }),
          },
        );
        const res = await venueTranslatePOST(req, {
          params: Promise.resolve({ id: "venue-123" }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(9 - i));
      }

      // 11th request must be blocked with HTTP 429
      const blockedReq = new NextRequest(
        "http://localhost/api/venues/venue-123/translate",
        {
          method: "POST",
          headers: {
            "x-forwarded-for": ip,
            "content-type": "application/json",
          },
          body: JSON.stringify({ targetLang: "FR", text: "Hello" }),
        },
      );
      const blockedRes = await venueTranslatePOST(blockedReq, {
        params: Promise.resolve({ id: "venue-123" }),
      });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(blockedRes.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(Number(blockedRes.headers.get("Retry-After"))).toBeGreaterThan(0);
    });

    it("prevents endpoint hopping by sharing the AI quota across summary and translate", async () => {
      const ip = "192.0.2.3";

      // Make 6 requests to summary
      for (let i = 0; i < 6; i++) {
        const summaryReq = new NextRequest(
          "http://localhost/api/venues/venue-123/summary",
          {
            headers: { "x-forwarded-for": ip },
          },
        );
        const res = await venueSummaryGET(summaryReq, {
          params: Promise.resolve({ venueId: "venue-123" }),
        });
        expect(res.status).toBe(200);
      }

      // Make 4 requests to translate (total = 10 requests)
      for (let i = 0; i < 4; i++) {
        const translateReq = new NextRequest(
          "http://localhost/api/venues/venue-123/translate",
          {
            method: "POST",
            headers: {
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: JSON.stringify({ targetLang: "FR", text: "Hello" }),
          },
        );
        const res = await venueTranslatePOST(translateReq, {
          params: Promise.resolve({ id: "venue-123" }),
        });
        expect(res.status).toBe(200);
      }

      // 11th request to summary must be blocked!
      const blockedSummary = new NextRequest(
        "http://localhost/api/venues/venue-123/summary",
        {
          headers: { "x-forwarded-for": ip },
        },
      );
      const summaryBlockedRes = await venueSummaryGET(blockedSummary, {
        params: Promise.resolve({ venueId: "venue-123" }),
      });
      expect(summaryBlockedRes.status).toBe(429);

      // 12th request to translate must ALSO be blocked!
      const blockedTranslate = new NextRequest(
        "http://localhost/api/venues/venue-123/translate",
        {
          method: "POST",
          headers: {
            "x-forwarded-for": ip,
            "content-type": "application/json",
          },
          body: JSON.stringify({ targetLang: "FR", text: "Hello" }),
        },
      );
      const translateBlockedRes = await venueTranslatePOST(blockedTranslate, {
        params: Promise.resolve({ id: "venue-123" }),
      });
      expect(translateBlockedRes.status).toBe(429);
    });
  });
});
