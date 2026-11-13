const mockEval = jest.fn();

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;

function resetMocks() {
  mockEval.mockReset();
}

jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    eval: mockEval,
  })),
}));

import {
  rateLimit,
  getRateLimitInfo,
  resetRateLimit,
  resetRedisScripts,
  microTimestampMember,
  SLIDING_WINDOW_LOG_LUA_SCRIPT,
} from "@/lib/rateLimit";

describe("Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimit();
    resetRedisScripts();
    resetMocks();
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

describe("custom window duration", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("should allow requests within a custom 5-minute window", async () => {
    const key = "custom-window-test";
    const fiveMinMs = 300_000;

    for (let i = 0; i < 3; i++) {
      expect(await rateLimit(key, 3, fiveMinMs)).toBe(true);
    }

    expect(await rateLimit(key, 3, fiveMinMs)).toBe(false);
  });

  it("should track different windows independently per key", async () => {
    const key1 = "window-a";
    const key2 = "window-b";

    for (let i = 0; i < 3; i++) {
      await rateLimit(key1, 3, 60_000);
    }

    expect(await rateLimit(key1, 3, 60_000)).toBe(false);
    expect(await rateLimit(key2, 3, 60_000)).toBe(true);
  });

  it("should return correct info for custom window", async () => {
    const key = "info-custom-window";
    const fiveMinMs = 300_000;

    let info = await getRateLimitInfo(key, 3, fiveMinMs);
    expect(info?.remaining).toBe(3);

    await rateLimit(key, 3, fiveMinMs);
    info = await getRateLimitInfo(key, 3, fiveMinMs);
    expect(info?.count).toBe(1);
    expect(info?.remaining).toBe(2);

    for (let i = 0; i < 2; i++) {
      await rateLimit(key, 3, fiveMinMs);
    }
    info = await getRateLimitInfo(key, 3, fiveMinMs);
    expect(info?.isLimited).toBe(true);
    expect(info?.remaining).toBe(0);
  });
});

describe("Redis sliding window atomic Lua script (EVAL)", () => {
  beforeEach(() => {
    resetRedisScripts();
    resetMocks();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisScripts();
  });

  it("evaluates the sliding window Lua script atomically", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockEval.mockResolvedValueOnce([1, "4", 1_700_000_060, 0, "1"]);

    expect(await rateLimit("test-ip", 5)).toBe(true);

    const key = "worksphere:ratelimit:test-ip";
    const evalCalls = mockEval.mock.calls;
    const lastCall = evalCalls[evalCalls.length - 1];
    // Verify the Lua script was called with correct args
    expect(lastCall[0]).toBe(SLIDING_WINDOW_LOG_LUA_SCRIPT);
    expect(lastCall[1]).toEqual([key]);
    // Argv[1]=limit, Argv[2]=windowMs, Argv[3]=now, Argv[4]=member, Argv[5]=cost
    expect(Number(lastCall[2][0])).toBe(5); // limit
    expect(Number(lastCall[2][1])).toBe(60_000); // windowMs
    expect(Number(lastCall[2][2])).toBe(now); // now
    expect(typeof lastCall[2][3]).toBe("string"); // member (random nonce)
    expect(Number(lastCall[2][4])).toBe(1); // cost
  });

  it("blocks requests when limit is exceeded", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockEval.mockResolvedValueOnce([0, "0", 1_700_000_060, 30, "5"]);

    expect(await rateLimit("blocked-ip", 5)).toBe(false);
  });

  it("allows requests under the limit across multiple calls", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockEval
      .mockResolvedValueOnce([1, "4", 1_700_000_060, 0, "1"])
      .mockResolvedValueOnce([1, "3", 1_700_000_060, 0, "2"])
      .mockResolvedValueOnce([1, "2", 1_700_000_060, 0, "3"])
      .mockResolvedValueOnce([0, "0", 1_700_000_060, 30, "5"]);

    expect(await rateLimit("multi-ip", 3)).toBe(true);
    expect(await rateLimit("multi-ip", 3)).toBe(true);
    expect(await rateLimit("multi-ip", 3)).toBe(true);
    expect(await rateLimit("multi-ip", 3)).toBe(false);
  });

  it("enforces strict sliding window sub-bucket eviction on Redis cluster reconnect (#5037)", async () => {
    const { SlidingWindowLimiter } = require("@/lib/rateLimit/limiters/slidingWindowLimiter");
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 10_000 });
    const ip = "reconnect-ip";

    // 1. Simulate Redis Disconnected: Process 2 requests in memory fallback
    delete process.env.UPSTASH_REDIS_REST_URL;
    const now1 = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now1);

    expect((await limiter.consume(ip)).success).toBe(true);
    expect((await limiter.consume(ip)).success).toBe(true);

    // 2. Advance time past windowMs (15 seconds later -> in-memory sub-buckets expire)
    const now2 = now1 + 15_000;
    jest.spyOn(Date, "now").mockReturnValue(now2);

    // 3. Simulate Redis Reconnected
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    resetRedisScripts();

    mockEval.mockResolvedValueOnce([1, "2", 1_700_000_020, 0, "1"]);

    // Consuming on reconnect must purge expired sub-buckets and succeed without quota burst
    const res = await limiter.consume(ip);
    expect(res.success).toBe(true);
  });
});
