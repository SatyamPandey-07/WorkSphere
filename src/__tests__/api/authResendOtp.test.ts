import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/resend-otp/route";
import {
  resetRateLimit,
  resetRedisScripts,
} from "@/lib/rateLimit";
import { verifyCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/csrf";

const mockMulti = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};
const mockZrem = jest.fn().mockResolvedValue(1);

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    multi: () => mockMulti,
    zrem: mockZrem,
  })),
}));

jest.mock("@/lib/csrf", () => ({
  verifyCsrfToken: jest.fn().mockResolvedValue(true),
  CSRF_COOKIE_NAME: "csrf-token",
  CSRF_HEADER_NAME: "x-csrf-token",
}));

describe("POST /api/auth/resend-otp", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    (verifyCsrfToken as jest.Mock).mockResolvedValue(true);
    resetRateLimit();
    resetRedisScripts();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function makeRequest(
    body: unknown,
    options?: {
      ip?: string;
      realIp?: string;
      csrfCookie?: string;
      csrfHeader?: string;
      rawBody?: string;
    },
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: options?.csrfHeader ?? "valid-token",
    };

    if (options?.ip) {
      headers["x-forwarded-for"] = options.ip;
    }
    if (options?.realIp) {
      headers["x-real-ip"] = options.realIp;
    }

    const req = new NextRequest("http://localhost/api/auth/resend-otp", {
      method: "POST",
      headers,
      body: options?.rawBody !== undefined ? options.rawBody : JSON.stringify(body),
    });

    req.cookies.set(CSRF_COOKIE_NAME, options?.csrfCookie ?? "valid-token");
    return req;
  }

  describe("Successful OTP Resend", () => {
    it("returns 200 with success message for valid email within rate limit threshold", async () => {
      const req = makeRequest({ email: "user@example.com" }, { ip: "192.168.1.10" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        message: "A new verification code has been sent to your email.",
      });
    });

    it("extracts client IP from x-real-ip when x-forwarded-for is missing", async () => {
      const req = makeRequest({ email: "user-real-ip@example.com" }, { realIp: "10.0.0.99" });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it("extracts the first IP from comma-separated x-forwarded-for header", async () => {
      const req = makeRequest(
        { email: "proxy-user@example.com" },
        { ip: "203.0.113.195, 70.41.3.18, 150.172.238.178" },
      );
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it("falls back to anonymous identifier when no IP headers are present", async () => {
      const req = makeRequest({ email: "anonymous-user@example.com" });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe("Rate Limiting Thresholds & Cooldown Headers", () => {
    it("rejects with 429 Too Many Requests when rate limit (1 request per window) is exceeded", async () => {
      const body = { email: "cooldown@example.com" };
      const ip = "192.168.1.50";

      // 1st request should succeed
      const firstReq = makeRequest(body, { ip });
      const firstRes = await POST(firstReq);
      expect(firstRes.status).toBe(200);

      // 2nd request in same window should be blocked with 429
      const secondReq = makeRequest(body, { ip });
      const secondRes = await POST(secondReq);
      expect(secondRes.status).toBe(429);

      const data = await secondRes.json();
      expect(data.error).toBe(
        "Too many OTP requests. Please wait before requesting a new code.",
      );
      expect(typeof data.retryAfter).toBe("number");
      expect(data.retryAfter).toBeGreaterThan(0);
      expect(data.retryAfter).toBeLessThanOrEqual(60);

      // Verify cooldown headers
      expect(secondRes.headers.get("Retry-After")).toBe(String(data.retryAfter));
      expect(secondRes.headers.get("X-RateLimit-Limit")).toBe("1");
      expect(secondRes.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("tracks rate limits separately across different email addresses on same IP", async () => {
      const ip = "192.168.1.55";

      const reqA1 = makeRequest({ email: "userA@example.com" }, { ip });
      const resA1 = await POST(reqA1);
      expect(resA1.status).toBe(200);

      // User B from same IP should not be blocked
      const reqB1 = makeRequest({ email: "userB@example.com" }, { ip });
      const resB1 = await POST(reqB1);
      expect(resB1.status).toBe(200);

      // Subsequent request for User A is blocked
      const reqA2 = makeRequest({ email: "userA@example.com" }, { ip });
      const resA2 = await POST(reqA2);
      expect(resA2.status).toBe(429);
    });

    it("tracks rate limits separately for same email on different IPs", async () => {
      const email = "shared@example.com";

      const req1 = makeRequest({ email }, { ip: "192.168.1.60" });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // Same email from different IP should be tracked independently
      const req2 = makeRequest({ email }, { ip: "192.168.1.61" });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
    });

    it("allows a new request after cooldown period expires", async () => {
      let currentTime = 1700000000000;
      const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => currentTime);

      const body = { email: "timer-cooldown@example.com" };
      const ip = "192.168.1.70";

      const req1 = makeRequest(body, { ip });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // Blocked immediately in same window
      const req2 = makeRequest(body, { ip });
      const res2 = await POST(req2);
      expect(res2.status).toBe(429);

      // Advance time by 61 seconds (beyond 60-second window)
      currentTime += 61_000;

      const req3 = makeRequest(body, { ip });
      const res3 = await POST(req3);
      expect(res3.status).toBe(200);

      dateSpy.mockRestore();
    });
  });

  describe("Validation & Error Handling", () => {
    it("returns 400 for invalid email format", async () => {
      const req = makeRequest({ email: "not-an-email" });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("A valid email address is required.");
    });

    it("returns 400 when email field is missing", async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("returns 400 when request body contains invalid JSON", async () => {
      const req = makeRequest(null, { rawBody: "invalid-json-string{" });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid JSON body.");
    });

    it("returns 403 when CSRF validation fails", async () => {
      (verifyCsrfToken as jest.Mock).mockResolvedValueOnce(false);

      const req = makeRequest({ email: "csrf-fail@example.com" });
      const res = await POST(req);

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("CSRF validation failed");
    });
  });

  describe("Distributed Upstash Redis Rate Limiting", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
    });

    it("allows request when Upstash Redis zcard count is within limit", async () => {
      // MULTI exec returns [remCount, addCount, cardCount, expireCount]
      mockMulti.exec.mockResolvedValueOnce([0, 1, 1, 1]);

      const req = makeRequest({ email: "upstash-allow@example.com" }, { ip: "10.10.10.1" });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it("blocks request and returns 429 when Upstash Redis zcard exceeds limit", async () => {
      // count = 2 which is > limit (1)
      mockMulti.exec.mockResolvedValueOnce([0, 1, 2, 1]);

      const req = makeRequest({ email: "upstash-block@example.com" }, { ip: "10.10.10.2" });
      const res = await POST(req);

      expect(res.status).toBe(429);
      expect(mockZrem).toHaveBeenCalled();
      const data = await res.json();
      expect(data.error).toContain("Too many OTP requests");
      expect(res.headers.get("Retry-After")).toBeDefined();
    });
  });

  describe("Limiter identifier & guardrails (supplemental, from #3386)", () => {
    it("uses resend-otp:<email>:<ip> as the limiter identifier", async () => {
      const email = "identifier-check@example.com";
      const ip = "203.0.113.5";

      const first = await POST(makeRequest({ email }, { ip }));
      expect(first.status).toBe(200);

      const blocked = await POST(makeRequest({ email }, { ip }));
      expect(blocked.status).toBe(429);

      // Resetting the exact identifier must clear the block, proving the key format.
      resetRateLimit(`resend-otp:${email}:${ip}`);
      const afterReset = await POST(makeRequest({ email }, { ip }));
      expect(afterReset.status).toBe(200);
    });

    it("does not consume rate-limit budget for invalid email", async () => {
      const email = "guard-invalid@example.com";
      const ip = "203.0.113.11";

      const bad = await POST(makeRequest({ email: "not-an-email" }, { ip }));
      expect(bad.status).toBe(400);

      const good = await POST(makeRequest({ email }, { ip }));
      expect(good.status).toBe(200);
      const again = await POST(makeRequest({ email }, { ip }));
      expect(again.status).toBe(429);
    });

    it("does not consume rate-limit budget for malformed JSON", async () => {
      const ip = "203.0.113.12";
      const bad = await POST(
        makeRequest(null, { ip, rawBody: "{ this is not json" }),
      );
      expect(bad.status).toBe(400);
      const data = await bad.json();
      expect(data.error).toBe("Invalid JSON body.");

      const good = await POST(
        makeRequest({ email: "guard-json@example.com" }, { ip }),
      );
      expect(good.status).toBe(200);
    });

    it("does not consume rate-limit budget when CSRF validation fails", async () => {
      const email = "csrf-guard@example.com";
      const ip = "203.0.113.7";

      (verifyCsrfToken as jest.Mock).mockResolvedValueOnce(false);
      const forbidden = await POST(makeRequest({ email }, { ip }));
      expect(forbidden.status).toBe(403);

      const good = await POST(makeRequest({ email }, { ip }));
      expect(good.status).toBe(200);
      const blocked = await POST(makeRequest({ email }, { ip }));
      expect(blocked.status).toBe(429);
    });
  });
});
