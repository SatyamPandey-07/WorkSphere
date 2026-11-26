import {
  pingRedisDiagnostic,
  DEFAULT_REDIS_PING_TIMEOUT_MS,
} from "@/lib/redis";
import { Redis } from "@upstash/redis";

describe("pingRedisDiagnostic (Issue #10611 & #10603)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "mock-token",
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    process.env = originalEnv;
  });

  it("completes fast ping before timeout and returns connected: true and finite latency", async () => {
    const mockClient = {
      ping: jest.fn().mockResolvedValue("PONG"),
    } as unknown as Redis;

    const resultPromise = pingRedisDiagnostic({ pingTimeoutMs: 1000 }, mockClient);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.latencyMs).not.toBeNull();
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latency).toEqual(result.latencyMs);
    expect(result.error).toBeUndefined();
    expect(mockClient.ping).toHaveBeenCalledTimes(1);
  });

  it("returns null latency and connected: false when Redis ping times out", async () => {
    const mockClient = {
      ping: jest.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    } as unknown as Redis;

    const pingPromise = pingRedisDiagnostic({ pingTimeoutMs: 500 }, mockClient);

    // Advance timers past timeout
    jest.advanceTimersByTime(500);

    const result = await pingPromise;
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.latency).toBeNull();
    expect(result.error).toMatch(/Redis ping timed out after 500ms/);
  });

  it("returns null latency and connected: false when Redis is disconnected or offline", async () => {
    const mockDisconnectedClient = {
      status: "close",
      ping: jest.fn().mockRejectedValue(new Error("Connection is closed")),
    } as unknown as Redis;

    const result = await pingRedisDiagnostic(undefined, mockDisconnectedClient);
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.latency).toBeNull();
    expect(result.error).toContain("close");
  });

  it("returns null latency and connected: false when Redis is unconfigured or null", async () => {
    const result = await pingRedisDiagnostic(undefined, null);
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.latency).toBeNull();
    expect(result.error).toContain("Redis client is not configured");
  });

  it("returns null latency and connected: false when Redis client throws on ping error", async () => {
    const mockErrorClient = {
      ping: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as unknown as Redis;

    const result = await pingRedisDiagnostic(undefined, mockErrorClient);
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.latency).toBeNull();
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("guards against mocked or non-function ping clients without throwing or returning NaN", async () => {
    const invalidMock = {} as unknown as Redis;

    const result = await pingRedisDiagnostic(undefined, invalidMock);
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.latency).toBeNull();
    expect(Number.isNaN(result.latencyMs)).toBe(false);
  });
});
