import { normalizeRedisResetAt } from "@/lib/rateLimit/limiters/tokenBucketLimiter";

describe("normalizeRedisResetAt", () => {
  const now = 1_800_000_000_000;
  const windowMs = 60_000;

  it.each([-1, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "uses the configured fallback window for invalid Redis TTL sentinel %s",
    (value) => {
      expect(normalizeRedisResetAt(value, now, windowMs)).toBe(now + windowMs);
    },
  );

  it("falls back when Redis returns an expired absolute timestamp", () => {
    expect(normalizeRedisResetAt(now - 1, now, windowMs)).toBe(now + windowMs);
  });

  it("falls back for non-numeric strings and empty values", () => {
    expect(normalizeRedisResetAt("not-a-number", now, windowMs)).toBe(now + windowMs);
    expect(normalizeRedisResetAt("", now, windowMs)).toBe(now + windowMs);
    expect(normalizeRedisResetAt(null, now, windowMs)).toBe(now + windowMs);
  });

  it("accepts a valid future epoch-millisecond reset", () => {
    expect(normalizeRedisResetAt(now + 12_345, now, windowMs)).toBe(now + 12_345);
  });

  it("accepts a numeric epoch-millisecond string", () => {
    expect(normalizeRedisResetAt(String(now + 9_000), now, windowMs)).toBe(now + 9_000);
  });

  it("uses a safe default window when the configured fallback is invalid", () => {
    expect(normalizeRedisResetAt(-2, now, Number.NaN)).toBe(now + 60_000);
  });
});
