describe("Retry logic for venue booking operations", () => {
  function withExponentialBackoff(
    attempt: number,
    baseMs = 1000,
    maxMs = 30_000,
    factor = 2
  ): number {
    return Math.min(baseMs * Math.pow(factor, attempt), maxMs);
  }
  function shouldRetry(statusCode: number, attempt: number, maxAttempts = 3): boolean {
    if (attempt >= maxAttempts) return false;
    return [408, 429, 500, 502, 503, 504].includes(statusCode);
  }
  function jitter(delayMs: number, jitterFactor = 0.1): number {
    return delayMs + delayMs * jitterFactor * (Math.random() * 2 - 1);
  }
  it("first retry: 1000ms", () => { expect(withExponentialBackoff(0)).toBe(1000); });
  it("second retry: 2000ms", () => { expect(withExponentialBackoff(1)).toBe(2000); });
  it("capped at maxMs", () => { expect(withExponentialBackoff(10)).toBe(30_000); });
  it("retry on 503", () => { expect(shouldRetry(503, 0)).toBe(true); });
  it("no retry on 404", () => { expect(shouldRetry(404, 0)).toBe(false); });
  it("no retry after max attempts", () => { expect(shouldRetry(503, 3)).toBe(false); });
});
