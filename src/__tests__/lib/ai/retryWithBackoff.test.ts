import {
  retryWithBackoff,
  computeBackoffDelay,
  getErrorStatus,
  getRetryAfterMs,
  isRetryableLlmError,
  RETRYABLE_STATUS_CODES,
  DEFAULT_MAX_ATTEMPTS,
} from "@/lib/ai/retryWithBackoff";

function httpError(
  status: number,
  headers?: unknown,
): Error & { status: number; headers?: unknown } {
  return Object.assign(new Error(`HTTP ${status}`), { status, headers });
}

describe("retryWithBackoff (#7945)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("error classification", () => {
    it("retries only 429, 502, 503 and 504", () => {
      expect([...RETRYABLE_STATUS_CODES].sort()).toEqual([429, 502, 503, 504]);
      for (const status of [429, 502, 503, 504]) {
        expect(isRetryableLlmError(httpError(status))).toBe(true);
      }
      for (const status of [400, 401, 403, 404, 422, 500, 501]) {
        expect(isRetryableLlmError(httpError(status))).toBe(false);
      }
    });

    it("reads status from status, statusCode and response.status", () => {
      expect(getErrorStatus({ status: 429 })).toBe(429);
      expect(getErrorStatus({ statusCode: 503 })).toBe(503);
      expect(getErrorStatus({ response: { status: 504 } })).toBe(504);
      expect(getErrorStatus(new Error("boom"))).toBeUndefined();
      expect(getErrorStatus(null)).toBeUndefined();
      expect(getErrorStatus("429")).toBeUndefined();
      expect(isRetryableLlmError(new Error("network down"))).toBe(false);
    });
  });

  describe("computeBackoffDelay", () => {
    it("doubles the delay on each retry with no jitter", () => {
      const opts = {
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        jitterRatio: 0,
        random: () => 0.5,
      };
      expect(computeBackoffDelay(1, opts)).toBe(100);
      expect(computeBackoffDelay(2, opts)).toBe(200);
      expect(computeBackoffDelay(3, opts)).toBe(400);
      expect(computeBackoffDelay(4, opts)).toBe(800);
    });

    it("caps the exponential part at maxDelayMs", () => {
      const opts = { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0 };
      expect(computeBackoffDelay(4, opts)).toBe(500);
      expect(computeBackoffDelay(10, opts)).toBe(500);
    });

    it("adds jitter between 0 and jitterRatio of the exponential delay", () => {
      const base = { baseDelayMs: 1000, maxDelayMs: 10_000, jitterRatio: 0.25 };
      expect(computeBackoffDelay(1, { ...base, random: () => 0 })).toBe(1000);
      expect(computeBackoffDelay(1, { ...base, random: () => 0.5 })).toBe(1125);
      expect(computeBackoffDelay(1, { ...base, random: () => 1 })).toBe(1250);
      expect(computeBackoffDelay(2, { ...base, random: () => 1 })).toBe(2500);
    });

    it("falls back to defaults for invalid options", () => {
      const delay = computeBackoffDelay(1, {
        baseDelayMs: Number.NaN,
        maxDelayMs: -1,
        jitterRatio: Number.NaN,
        random: () => 0,
      });
      expect(delay).toBe(500);
    });
  });

  describe("getRetryAfterMs", () => {
    it("parses seconds from a Headers instance and a plain object", () => {
      expect(
        getRetryAfterMs({ headers: new Headers({ "retry-after": "3" }) }),
      ).toBe(3000);
      expect(getRetryAfterMs({ headers: { "Retry-After": "2.5" } })).toBe(2500);
    });

    it("parses an HTTP date relative to now", () => {
      const now = Date.UTC(2026, 10, 17, 12, 0, 0);
      const date = new Date(now + 4000).toUTCString();
      expect(getRetryAfterMs({ headers: { "retry-after": date } }, now)).toBe(
        4000,
      );
    });

    it("returns undefined when absent or invalid", () => {
      expect(getRetryAfterMs({})).toBeUndefined();
      expect(getRetryAfterMs({ headers: {} })).toBeUndefined();
      expect(
        getRetryAfterMs({ headers: { "retry-after": "soon" } }),
      ).toBeUndefined();
      expect(getRetryAfterMs(undefined)).toBeUndefined();
    });
  });

  describe("retry progression", () => {
    it("returns immediately when the first attempt succeeds", async () => {
      const fn = jest.fn().mockResolvedValue("ok");
      await expect(retryWithBackoff(fn)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(1);
    });

    it("waits base then doubled delays between attempts and then succeeds", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(httpError(429))
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValue("recovered");
      const onRetry = jest.fn();

      const promise = retryWithBackoff(fn, {
        baseDelayMs: 500,
        jitterRatio: 0,
        onRetry,
      });

      await jest.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(499);
      expect(fn).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(999);
      expect(fn).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(3);

      await expect(promise).resolves.toBe("recovered");
      expect(fn).toHaveBeenNthCalledWith(3, 3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry.mock.calls[0][0]).toMatchObject({
        attempt: 1,
        delayMs: 500,
      });
      expect(onRetry.mock.calls[1][0]).toMatchObject({
        attempt: 2,
        delayMs: 1000,
      });
    });

    it("uses 3 attempts by default and rejects with the last error", async () => {
      expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
      const last = httpError(502);
      const fn = jest
        .fn()
        .mockRejectedValueOnce(httpError(429))
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(last);

      const promise = retryWithBackoff(fn, { jitterRatio: 0 });
      const settled = promise.then(
        () => "resolved",
        (error: unknown) => error,
      );

      await jest.advanceTimersByTimeAsync(10_000);

      await expect(settled).resolves.toBe(last);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("honors a custom maxAttempts", async () => {
      const fn = jest.fn().mockRejectedValue(httpError(429));
      const settled = retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelayMs: 10,
        jitterRatio: 0,
      }).then(
        () => "resolved",
        () => "rejected",
      );

      await jest.advanceTimersByTimeAsync(10_000);

      await expect(settled).resolves.toBe("rejected");
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it("makes a single attempt when maxAttempts is 1", async () => {
      const fn = jest.fn().mockRejectedValue(httpError(429));
      await expect(
        retryWithBackoff(fn, { maxAttempts: 1 }),
      ).rejects.toMatchObject({ status: 429 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it.each([400, 401, 403, 404, 422, 500])(
      "does not retry a %i response",
      async (status) => {
        const fn = jest.fn().mockRejectedValue(httpError(status));
        await expect(retryWithBackoff(fn)).rejects.toMatchObject({ status });
        expect(fn).toHaveBeenCalledTimes(1);
      },
    );

    it("does not retry errors without a status", async () => {
      const fn = jest.fn().mockRejectedValue(new TypeError("bug"));
      await expect(retryWithBackoff(fn)).rejects.toThrow("bug");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("stops retrying as soon as a non-retryable error appears", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(httpError(429))
        .mockRejectedValueOnce(httpError(401));

      const settled = retryWithBackoff(fn, { jitterRatio: 0 }).then(
        () => "resolved",
        (error: unknown) => error,
      );
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(settled).resolves.toMatchObject({ status: 401 });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("applies jitter to the wait using the injected random source", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(httpError(429))
        .mockResolvedValue("ok");
      const onRetry = jest.fn();

      const promise = retryWithBackoff(fn, {
        baseDelayMs: 1000,
        jitterRatio: 0.25,
        random: () => 1,
        onRetry,
      });
      await jest.advanceTimersByTimeAsync(1249);
      expect(fn).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe("ok");
      expect(onRetry.mock.calls[0][0].delayMs).toBe(1250);
    });

    it("waits at least as long as Retry-After, capped at maxDelayMs", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(httpError(429, { "retry-after": "2" }))
        .mockRejectedValueOnce(httpError(429, { "retry-after": "120" }))
        .mockResolvedValue("ok");
      const onRetry = jest.fn();

      const promise = retryWithBackoff(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 5000,
        jitterRatio: 0,
        onRetry,
      });
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(promise).resolves.toBe("ok");
      expect(onRetry.mock.calls[0][0].delayMs).toBe(2000);
      expect(onRetry.mock.calls[1][0].delayMs).toBe(5000);
    });

    it("supports a custom isRetryable predicate", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("flaky"))
        .mockResolvedValue("ok");
      const promise = retryWithBackoff(fn, {
        baseDelayMs: 10,
        jitterRatio: 0,
        isRetryable: (error) =>
          error instanceof Error && error.message === "flaky",
      });
      await jest.advanceTimersByTimeAsync(10);
      await expect(promise).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
