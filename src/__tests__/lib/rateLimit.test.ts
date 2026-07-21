const mockMultiExec = jest.fn();
const mockMulti = {
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: mockMultiExec,
};

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    multi: () => mockMulti,
  })),
}));

import {
  rateLimit,
  getRateLimitInfo,
  resetRateLimit,
  resetRedisScripts,
  microTimestampMember,
} from "@/lib/rateLimit";

describe("Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimit();
    resetRedisScripts();
    mockMultiExec.mockReset();
    mockMulti.incr.mockClear();
    mockMulti.expire.mockClear();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
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

  // Lua script test removed in favor of pipeline transactions.
});

describe("microTimestampMember", () => {
  it("stringifies sec+usec so same-ms hits stay unique", () => {
    const a = microTimestampMember(1700000000, 12, "a");
    const b = microTimestampMember(1700000000, 13, "a");
    expect(a).toBe("1700000000000012:a");
    expect(b).toBe("1700000000000013:a");
    expect(a).not.toBe(b);
  });

  it("pads usec to 6 digits", () => {
    expect(microTimestampMember("100", 5, "x")).toBe("100000005:x");
  });
});

describe("Redis sliding window path", () => {
  beforeEach(() => {
    resetRedisScripts();
    mockMultiExec.mockReset();
    mockMulti.incr.mockClear();
    mockMulti.expire.mockClear();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisScripts();
  });

  it("blocks after the pipeline result count exceeds limit", async () => {
    let hits = 0;
    mockMultiExec.mockImplementation(async () => {
      hits += 1;
      return [hits];
    });

    expect(await rateLimit("redis-ip", 3)).toBe(true);
    expect(await rateLimit("redis-ip", 3)).toBe(true);
    expect(await rateLimit("redis-ip", 3)).toBe(true);
    expect(await rateLimit("redis-ip", 3)).toBe(false);
    expect(mockMultiExec).toHaveBeenCalledTimes(4);
  });

  it("uses the correct rate limit key format with pipeline", async () => {
    mockMultiExec.mockResolvedValue([1]);

    await Promise.all([
      rateLimit("burst-ip", 10),
      rateLimit("burst-ip", 10),
      rateLimit("burst-ip", 10),
    ]);

    expect(mockMultiExec).toHaveBeenCalledTimes(3);
    const keys = mockMulti.incr.mock.calls.map((call) => call[0]);
    expect(
      keys.every(
        (k) =>
          typeof k === "string" &&
          k.startsWith("worksphere:ratelimit:burst-ip:"),
      ),
    ).toBe(true);
  });
});
