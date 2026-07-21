const mockPipeline = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    pipeline: () => mockPipeline,
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
    mockPipeline.exec.mockReset();
    mockPipeline.zremrangebyscore.mockClear();
    mockPipeline.zcard.mockClear();
    mockPipeline.zadd.mockClear();
    mockPipeline.expire.mockClear();
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

describe("Redis sliding window ZREMRANGEBYSCORE + ZCARD pipeline", () => {
  beforeEach(() => {
    resetRedisScripts();
    mockPipeline.exec.mockReset();
    mockPipeline.zremrangebyscore.mockClear();
    mockPipeline.zcard.mockClear();
    mockPipeline.zadd.mockClear();
    mockPipeline.expire.mockClear();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisScripts();
  });

  it("pipelines zremrangebyscore then zcard before allowing a hit", async () => {
    mockPipeline.exec
      .mockResolvedValueOnce([0, 0])
      .mockResolvedValueOnce([1, 1]);

    expect(await rateLimit("redis-ip", 3)).toBe(true);

    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledTimes(1);
    expect(mockPipeline.zcard).toHaveBeenCalledTimes(1);
    expect(mockPipeline.zadd).toHaveBeenCalledTimes(1);
    expect(mockPipeline.expire).toHaveBeenCalledTimes(1);
    expect(mockPipeline.exec).toHaveBeenCalledTimes(2);

    const key = mockPipeline.zremrangebyscore.mock.calls[0][0];
    expect(key).toBe("worksphere:ratelimit:redis-ip");
    expect(mockPipeline.zcard.mock.calls[0][0]).toBe(key);
  });

  it("blocks when ZCARD is already at the limit without writing", async () => {
    mockPipeline.exec.mockResolvedValueOnce([0, 3]);

    expect(await rateLimit("full-ip", 3)).toBe(false);
    expect(mockPipeline.zadd).not.toHaveBeenCalled();
    expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("allows until ZCARD reaches the limit across calls", async () => {
    mockPipeline.exec
      .mockResolvedValueOnce([0, 0])
      .mockResolvedValueOnce([1, 1])
      .mockResolvedValueOnce([0, 1])
      .mockResolvedValueOnce([1, 1])
      .mockResolvedValueOnce([0, 2])
      .mockResolvedValueOnce([1, 1])
      .mockResolvedValueOnce([0, 3]);

    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(true);
    expect(await rateLimit("burst-ip", 3)).toBe(false);

    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledTimes(4);
    expect(mockPipeline.zcard).toHaveBeenCalledTimes(4);
    expect(mockPipeline.zadd).toHaveBeenCalledTimes(3);
  });
});
