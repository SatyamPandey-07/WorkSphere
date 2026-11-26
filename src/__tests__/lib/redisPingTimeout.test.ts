import {
  pingRedisDiagnostic,
  DEFAULT_REDIS_PING_TIMEOUT_MS,
  RedisPingOptions,
} from "@/lib/redis";
import { Redis } from "@upstash/redis";

describe("pingRedisDiagnostic (Issue #10603)", () => {
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

  it("completes fast ping before timeout", async () => {
    const mockClient = {
      ping: jest.fn().mockResolvedValue("PONG"),
    } as unknown as Redis;

    const resultPromise = pingRedisDiagnostic({ pingTimeoutMs: 1000 }, mockClient);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockClient.ping).toHaveBeenCalledTimes(1);
  });

  it("times out when ping exceeds pingTimeoutMs", async () => {
    const mockClient = {
      ping: jest.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    } as unknown as Redis;

    const pingPromise = pingRedisDiagnostic({ pingTimeoutMs: 500 }, mockClient);

    // Advance timers past timeout
    jest.advanceTimersByTime(500);

    const result = await pingPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Redis ping timed out after 500ms/);
  });

  it("uses default timeout when no option is supplied", async () => {
    expect(DEFAULT_REDIS_PING_TIMEOUT_MS).toBe(2000);

    const mockClient = {
      ping: jest.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    } as unknown as Redis;

    const pingPromise = pingRedisDiagnostic(undefined, mockClient);

    // Advance 1999ms - should still be waiting
    jest.advanceTimersByTime(1999);
    let resolved = false;
    pingPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve(); // tick event loop
    expect(resolved).toBe(false);

    // Advance remaining 1ms to hit default 2000ms
    jest.advanceTimersByTime(1);
    const result = await pingPromise;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(
      new RegExp(`Redis ping timed out after ${DEFAULT_REDIS_PING_TIMEOUT_MS}ms`)
    );
  });

  it("safely cleans up pending timers and handles Redis errors", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    // Test error from ping
    const mockClientError = {
      ping: jest.fn().mockRejectedValue(new Error("Network connection lost")),
    } as unknown as Redis;

    const result = await pingRedisDiagnostic({ pingTimeoutMs: 1500 }, mockClientError);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Network connection lost");
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("cleans up timer on timeout", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    const mockClientStalled = {
      ping: jest.fn().mockImplementation(() => new Promise(() => {})),
    } as unknown as Redis;

    const pingPromise = pingRedisDiagnostic({ pingTimeoutMs: 300 }, mockClientStalled);
    jest.advanceTimersByTime(300);

    const result = await pingPromise;
    expect(result.ok).toBe(false);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("returns failure when redis client is not configured", async () => {
    const result = await pingRedisDiagnostic(undefined, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Redis client is not configured");
  });
});
