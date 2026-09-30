/**
 * Tests for venue booking partner API integration.
 */

interface PartnerApiConfig {
  partnerId: string;
  partnerName: string;
  apiKey: string;
  baseUrl: string;
  rateLimit: number;    // requests per minute
  timeout: number;      // ms
  webhookUrl: string | null;
  isActive: boolean;
}

interface ApiCall {
  callId: string;
  partnerId: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  timestamp: number;
  responseTimeMs: number;
  statusCode: number;
  success: boolean;
}

function rateLimitAllowed(
  recentCalls: ApiCall[],
  config: PartnerApiConfig,
  nowMs: number
): boolean {
  const windowStart = nowMs - 60_000; // last 1 minute
  const recentCount = recentCalls.filter(
    (c) => c.partnerId === config.partnerId && c.timestamp >= windowStart
  ).length;
  return recentCount < config.rateLimit;
}

function partnerSuccessRate(calls: ApiCall[], partnerId: string): number {
  const partnerCalls = calls.filter((c) => c.partnerId === partnerId);
  if (partnerCalls.length === 0) return 0;
  const successful = partnerCalls.filter((c) => c.success).length;
  return Math.round((successful / partnerCalls.length) * 100);
}

function avgResponseTime(calls: ApiCall[], partnerId: string): number {
  const partnerCalls = calls.filter((c) => c.partnerId === partnerId);
  if (partnerCalls.length === 0) return 0;
  return Math.round(partnerCalls.reduce((s, c) => s + c.responseTimeMs, 0) / partnerCalls.length);
}

function isPartnerHealthy(config: PartnerApiConfig, calls: ApiCall[]): boolean {
  if (!config.isActive) return false;
  const rate = partnerSuccessRate(calls, config.partnerId);
  const avgTime = avgResponseTime(calls, config.partnerId);
  return rate >= 95 && avgTime < config.timeout;
}

const NOW = 1_700_000_000_000;
const PARTNER_CONFIG: PartnerApiConfig = {
  partnerId: "p1", partnerName: "BookingCo", apiKey: "key-abc",
  baseUrl: "https://api.bookingco.com", rateLimit: 60, timeout: 5000,
  webhookUrl: null, isActive: true,
};

const CALLS: ApiCall[] = [
  { callId: "c1", partnerId: "p1", endpoint: "/availability", method: "GET", timestamp: NOW - 30_000, responseTimeMs: 250, statusCode: 200, success: true  },
  { callId: "c2", partnerId: "p1", endpoint: "/book",         method: "POST",timestamp: NOW - 20_000, responseTimeMs: 450, statusCode: 200, success: true  },
  { callId: "c3", partnerId: "p1", endpoint: "/cancel",       method: "POST",timestamp: NOW - 10_000, responseTimeMs: 6000,statusCode: 500, success: false },
];

describe("Partner API integration", () => {
  it("rateLimitAllowed: 3 calls < limit 60 → true", () => {
    expect(rateLimitAllowed(CALLS, PARTNER_CONFIG, NOW)).toBe(true);
  });

  it("rateLimitAllowed: at rate limit → false", () => {
    const manyCalls = Array.from({ length: 60 }, (_, i) => ({
      ...CALLS[0], callId: `mc${i}`, timestamp: NOW - 1000,
    }));
    expect(rateLimitAllowed(manyCalls, PARTNER_CONFIG, NOW)).toBe(false);
  });

  it("partnerSuccessRate: 2 of 3 = 67%", () => {
    expect(partnerSuccessRate(CALLS, "p1")).toBe(67);
  });

  it("avgResponseTime: (250+450+6000)/3 ≈ 2233ms", () => {
    expect(avgResponseTime(CALLS, "p1")).toBeCloseTo(2233, 0);
  });

  it("isPartnerHealthy: high error rate + slow → false", () => {
    expect(isPartnerHealthy(PARTNER_CONFIG, CALLS)).toBe(false); // 67% success < 95% threshold
  });

  it("isPartnerHealthy: inactive config → false", () => {
    const inactive = { ...PARTNER_CONFIG, isActive: false };
    expect(isPartnerHealthy(inactive, CALLS)).toBe(false);
  });
});
