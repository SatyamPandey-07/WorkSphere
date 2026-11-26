import { getRedis } from "@/lib/redis";
import { measureRedisLatencyMs } from "@/lib/redisHealth";

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

describe("measureRedisLatencyMs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns unavailable when Redis is not configured", async () => {
    (getRedis as jest.Mock).mockReturnValue(null);

    await expect(measureRedisLatencyMs()).resolves.toEqual({
      ok: false,
      latencyMs: null,
    });
  });

  it("returns successful ping latency", async () => {
    (getRedis as jest.Mock).mockReturnValue({
      ping: jest.fn().mockResolvedValue("PONG"),
    });

    const result = await measureRedisLatencyMs();

    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("gracefully handles Redis ping failures", async () => {
    (getRedis as jest.Mock).mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const result = await measureRedisLatencyMs();

    expect(result.ok).toBe(false);
    expect(typeof result.latencyMs).toBe("number");
  });

  it("gracefully handles Redis client initialization failures", async () => {
    (getRedis as jest.Mock).mockImplementation(() => {
      throw new Error("Redis initialization failed");
    });

    const result = await measureRedisLatencyMs();

    expect(result).toEqual({
      ok: false,
      latencyMs: expect.any(Number),
    });
  });
});
