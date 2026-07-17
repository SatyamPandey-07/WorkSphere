import { rateLimit, getRateLimitInfo, resetRateLimit } from "@/lib/rateLimit";

describe("Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("should allow requests under the limit", async () => {
    const ip = "192.168.1.1";

    for (let i = 0; i < 10; i++) {
      expect(await rateLimit(ip)).toBe(true);
    }
  });

  it("should block requests over the limit", async () => {
    const ip = "192.168.1.2";

    // Make 10 requests (default limit)
    for (let i = 0; i < 10; i++) {
      await rateLimit(ip);
    }

    // 11th request should be blocked
    expect(await rateLimit(ip)).toBe(false);
  });

  it("should track different IPs separately", async () => {
    const ip1 = "192.168.1.3";
    const ip2 = "192.168.1.4";

    // Exhaust limit for ip1
    for (let i = 0; i < 10; i++) {
      await rateLimit(ip1);
    }

    // ip2 should still be allowed
    expect(await rateLimit(ip2)).toBe(true);
  });

  it("should respect custom limits", async () => {
    const ip = "192.168.1.5";

    // Custom limit of 5
    for (let i = 0; i < 5; i++) {
      expect(await rateLimit(ip, 5)).toBe(true);
    }

    expect(await rateLimit(ip, 5)).toBe(false);
  });

  it("should return correct rate limit info", async () => {
    const ip = "192.168.1.6";

    let info = await getRateLimitInfo(ip, 5);
    expect(info).not.toBeNull();
    expect(info?.count).toBe(0);
    expect(info?.remaining).toBe(5);
    expect(info?.isLimited).toBe(false);

    await rateLimit(ip, 5);
    info = await getRateLimitInfo(ip, 5);
    expect(info?.count).toBe(1);
    expect(info?.remaining).toBe(4);
    expect(info?.isLimited).toBe(false);

    for (let i = 0; i < 4; i++) {
      await rateLimit(ip, 5);
    }
    info = await getRateLimitInfo(ip, 5);
    expect(info?.count).toBe(5);
    expect(info?.remaining).toBe(0);
    expect(info?.isLimited).toBe(true);
  });
});
