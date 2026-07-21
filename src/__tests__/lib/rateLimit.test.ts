const mockMulti = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};

const mockZrem = jest.fn();

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    multi: () => mockMulti,
    zrem: mockZrem,
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
    mockMulti.exec.mockReset();
    mockMulti.zremrangebyscore.mockClear();
    mockMulti.zadd.mockClear();
    mockMulti.zcard.mockClear();
    mockMulti.expire.mockClear();
    mockZrem.mockReset();
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

    for (let i = 0; i < 10; i++) {
      await rateLimit(ip);
    }

    expect(await rateLimit(ip)).toBe(false);
  });

  it("should track different IPs separately", async () => {
    const ip1 = "192.168.1.3";
    const ip2 = "192.168.1.4";

    for (let i = 0; i < 10; i++) {
      await rateLimit(ip1);
    }

    expect(await rateLimit(ip2)).toBe(true);
  });

  it("should respect custom limits", async () => {
    const ip = "192.168.1.5";

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

describe("Redis sliding window atomic MULTI (ZREMRANGEBYSCORE + ZCARD)", () => {
  beforeEach(() => {
    resetRedisScripts();
    mockMulti.exec.mockReset();
    mockMulti.zremrangebyscore.mockClear();
    mockMulti.zadd.mockClear();
    mockMulti.zcard.mockClear();
    mockMulti.expire.mockClear();
    mockZrem.mockReset();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisScripts();
  });

  it("runs prune, add, card, and expire in one multi transaction", async () => {
    // rem, add, card, expire
    mockMulti.exec.mockResolvedValueOnce([0, 1, 1, 1]);

    expect(await rateLimit("redis-ip", 3)).toBe(true);

    expect(mockMulti.zremrangebyscore).toHaveBeenCalledTimes(1);
    expect(mockMulti.zadd).toHaveBeenCalledTimes(1);
    expect(mockMulti.zcard).toHaveBeenCalledTimes(1);
    expect(mockMulti.expire).toHaveBeenCalledTimes(1);
    expect(mockMulti.exec).toHaveBeenCalledTimes(1);
    expect(mockZrem).not.toHaveBeenCalled();

    const key = mockMulti.zremrangebyscore.mock.calls[0][0];
    expect(key).toBe("worksphere:ratelimit:redis-ip");
    expect(mockMulti.zcard.mock.calls[0][0]).toBe(key);
  });

  it("rejects and removes the optimistic member when ZCARD exceeds the limit", async () => {
    mockMulti.exec.mockResolvedValueOnce([0, 1, 4, 1]);

    expect(await rateLimit("full-ip", 3)).toBe(false);
    expect(mockZrem).toHaveBeenCalledTimes(1);
    expect(mockZrem.mock.calls[0][0]).toBe("worksphere:ratelimit:full-ip");
  });

  it("allows until ZCARD goes past the limit across calls", async () => {
    mockMulti.exec
      .mockResolvedValueOnce([0, 1, 1, 1])
      .mockResolvedValueOnce([0, 1, 2, 1])
      .mockResolvedValueOnce([0, 1, 3, 1])
      .mockResolvedValueOnce([0, 1, 4, 1]);

    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(false);

    expect(mockMulti.exec).toHaveBeenCalledTimes(4);
    expect(mockZrem).toHaveBeenCalledTimes(1);
  });
});
