/**
 * Tests for API rate limiting and throttling utilities for venue booking APIs.
 */

interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  burstAllowance: number;
}

interface ApiClient {
  clientId: string;
  tier: "free" | "basic" | "pro" | "enterprise";
  requestsThisMinute: number;
  requestsThisHour: number;
  burstUsed: number;
  lastRequestAt: number;
}

const TIER_LIMITS: Record<ApiClient["tier"], RateLimitConfig> = {
  free:       { requestsPerMinute: 10,  requestsPerHour: 100,  burstAllowance: 5 },
  basic:      { requestsPerMinute: 60,  requestsPerHour: 1000, burstAllowance: 20 },
  pro:        { requestsPerMinute: 300, requestsPerHour: 5000, burstAllowance: 100 },
  enterprise: { requestsPerMinute: Infinity, requestsPerHour: Infinity, burstAllowance: Infinity },
};

function isRateLimited(client: ApiClient): boolean {
  const limits = TIER_LIMITS[client.tier];
  return client.requestsThisMinute >= limits.requestsPerMinute ||
    client.requestsThisHour >= limits.requestsPerHour;
}

function canUseBurst(client: ApiClient): boolean {
  const limits = TIER_LIMITS[client.tier];
  return client.burstUsed < limits.burstAllowance;
}

function remainingMinuteRequests(client: ApiClient): number {
  const limits = TIER_LIMITS[client.tier];
  if (!isFinite(limits.requestsPerMinute)) return Infinity;
  return Math.max(0, limits.requestsPerMinute - client.requestsThisMinute);
}

function minuteUtilisation(client: ApiClient): number {
  const limits = TIER_LIMITS[client.tier];
  if (!isFinite(limits.requestsPerMinute)) return 0;
  return Math.round((client.requestsThisMinute / limits.requestsPerMinute) * 100);
}

function shouldResetWindow(client: ApiClient, nowMs: number): boolean {
  return nowMs - client.lastRequestAt >= 60_000;
}

const CLIENT: ApiClient = {
  clientId: "c1", tier: "free",
  requestsThisMinute: 8, requestsThisHour: 80,
  burstUsed: 3, lastRequestAt: 1_700_000_000_000,
};

describe("API rate limit utilities", () => {
  it("isRateLimited: 8 of 10 per minute → false", () => {
    expect(isRateLimited(CLIENT)).toBe(false);
  });

  it("isRateLimited: at minute limit → true", () => {
    expect(isRateLimited({ ...CLIENT, requestsThisMinute: 10 })).toBe(true);
  });

  it("canUseBurst: 3 used of 5 → true", () => {
    expect(canUseBurst(CLIENT)).toBe(true);
  });

  it("canUseBurst: 5 used of 5 → false", () => {
    expect(canUseBurst({ ...CLIENT, burstUsed: 5 })).toBe(false);
  });

  it("remainingMinuteRequests: 10 - 8 = 2", () => {
    expect(remainingMinuteRequests(CLIENT)).toBe(2);
  });

  it("minuteUtilisation: 8 of 10 = 80%", () => {
    expect(minuteUtilisation(CLIENT)).toBe(80);
  });

  it("shouldResetWindow: 2 min old → true", () => {
    expect(shouldResetWindow(CLIENT, CLIENT.lastRequestAt + 120_000)).toBe(true);
  });
});
