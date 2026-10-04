import {
  matchRateTier,
  getClientIp,
  checkInMemoryTokenBucket,
  checkTokenBucketRateLimit,
  resetTokenBuckets,
  RATE_TIERS,
} from "@/lib/tokenBucketRateLimit";

describe("Multi-Tier Token Bucket Rate Limiting (#3529)", () => {
  beforeEach(() => {
    resetTokenBuckets();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  describe("matchRateTier", () => {
    it("maps public search endpoints to 60 req/min tier", () => {
      const searchPaths = [
        "/api/venues",
        "/api/venues/enrich",
        "/api/venues/search",
        "/api/map/heatmap",
        "/api/map/forecast-heatmap",
        "/api/location",
      ];

      searchPaths.forEach((path) => {
        const tier = matchRateTier(path);
        expect(tier).not.toBeNull();
        expect(tier?.name).toBe("search");
        expect(tier?.limit).toBe(60);
      });
    });

    it("maps authentication endpoints to 5 req/min tier", () => {
      const authPaths = [
        "/api/auth/verify-otp",
        "/api/auth/reset-password",
        "/api/auth/forgot-password",
        "/api/auth/passkey/authenticate/verify",
        "/api/partykit/auth",
        "/api/user/verify-student",
      ];

      authPaths.forEach((path) => {
        const tier = matchRateTier(path);
        expect(tier).not.toBeNull();
        expect(tier?.name).toBe("auth");
        expect(tier?.limit).toBe(5);
      });
    });

    it("maps telemetry ingestion endpoints to 120 req/min tier", () => {
      const telemetryPaths = [
        "/api/telemetry/noise",
        "/api/venues/v-123/telemetry",
        "/api/venues/v-123/noise-metrics",
        "/api/venues/v-123/wifi-prediction",
      ];

      telemetryPaths.forEach((path) => {
        const tier = matchRateTier(path);
        expect(tier).not.toBeNull();
        expect(tier?.name).toBe("telemetry");
        expect(tier?.limit).toBe(120);
      });
    });

    it("exempts webhooks and cron jobs from rate limiting", () => {
      const exemptPaths = [
        "/api/webhook",
        "/api/webhooks/worker",
        "/api/cron/reminders",
        "/api/cron/partition-maintenance",
      ];

      exemptPaths.forEach((path) => {
        expect(matchRateTier(path)).toBeNull();
      });
    });
  });

  describe("getClientIp", () => {
    it("extracts first IP from x-forwarded-for header", () => {
      const req = new Request("http://localhost/api/venues", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("extracts IP from x-real-ip when x-forwarded-for is missing", () => {
      const req = new Request("http://localhost/api/venues", {
        headers: { "x-real-ip": "198.51.100.10" },
      });
      expect(getClientIp(req)).toBe("198.51.100.10");
    });

    it("falls back to 127.0.0.1 when no IP headers exist", () => {
      const req = new Request("http://localhost/api/venues");
      expect(getClientIp(req)).toBe("127.0.0.1");
    });
  });

  describe("checkInMemoryTokenBucket", () => {
    it("allows up to 5 requests for auth tier, then rejects with 429 info", () => {
      const tier = RATE_TIERS.auth;
      const id = "test-auth-client";

      // 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const result = checkInMemoryTokenBucket(tier, id);
        expect(result.success).toBe(true);
        expect(result.limit).toBe(5);
        expect(result.remaining).toBe(4 - i);
      }

      // 6th request is blocked
      const blocked = checkInMemoryTokenBucket(tier, id);
      expect(blocked.success).toBe(false);
      expect(blocked.limit).toBe(5);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfter).toBeGreaterThan(0);
      expect(blocked.reset).toBeGreaterThan(0);
    });

    it("allows up to 60 requests for search tier", () => {
      const tier = RATE_TIERS.search;
      const id = "test-search-client";

      for (let i = 0; i < 60; i++) {
        const result = checkInMemoryTokenBucket(tier, id);
        expect(result.success).toBe(true);
        expect(result.remaining).toBe(59 - i);
      }

      const blocked = checkInMemoryTokenBucket(tier, id);
      expect(blocked.success).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it("refills tokens over time", () => {
      jest.useFakeTimers();
      try {
        const tier = RATE_TIERS.auth; // 5 tokens per 60,000 ms (1 token every 12,000 ms)
        const id = "refill-client";

        // Exhaust all 5 tokens
        for (let i = 0; i < 5; i++) {
          checkInMemoryTokenBucket(tier, id);
        }

        expect(checkInMemoryTokenBucket(tier, id).success).toBe(false);

        // Advance time by 12 seconds
        jest.advanceTimersByTime(12_000);

        // One token refilled
        const refilledResult = checkInMemoryTokenBucket(tier, id);
        expect(refilledResult.success).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it("checkTokenBucketRateLimit falls back to in-memory when Redis is not configured", async () => {
      const result = await checkTokenBucketRateLimit(RATE_TIERS.telemetry, "client-1");
      expect(result.success).toBe(true);
      expect(result.limit).toBe(120);
      expect(result.remaining).toBe(119);
    });
  });
});
