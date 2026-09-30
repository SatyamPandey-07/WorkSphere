/**
 * Tests for booking surge detection and rate limiting.
 */

interface BookingAttempt {
  userId: string;
  venueId: string;
  attemptedAt: number;
  succeeded: boolean;
}

function surgeWindowCount(
  attempts: BookingAttempt[],
  venueId: string,
  windowMs: number,
  nowMs: number
): number {
  return attempts.filter(
    (a) => a.venueId === venueId && nowMs - a.attemptedAt <= windowMs
  ).length;
}

function isSurging(
  attempts: BookingAttempt[],
  venueId: string,
  windowMs: number,
  nowMs: number,
  threshold: number
): boolean {
  return surgeWindowCount(attempts, venueId, windowMs, nowMs) >= threshold;
}

function perUserAttempts(
  attempts: BookingAttempt[],
  userId: string,
  venueId: string,
  windowMs: number,
  nowMs: number
): number {
  return attempts.filter(
    (a) => a.userId === userId && a.venueId === venueId && nowMs - a.attemptedAt <= windowMs
  ).length;
}

function shouldRateLimit(
  attempts: BookingAttempt[],
  userId: string,
  venueId: string,
  windowMs: number,
  nowMs: number,
  maxPerUser: number
): boolean {
  return perUserAttempts(attempts, userId, venueId, windowMs, nowMs) >= maxPerUser;
}

const NOW = 1_700_000_000_000;
const ATTEMPTS: BookingAttempt[] = [
  { userId: "u1", venueId: "v1", attemptedAt: NOW - 30_000, succeeded: true  },
  { userId: "u2", venueId: "v1", attemptedAt: NOW - 60_000, succeeded: true  },
  { userId: "u3", venueId: "v1", attemptedAt: NOW - 90_000, succeeded: false },
  { userId: "u1", venueId: "v1", attemptedAt: NOW - 10_000, succeeded: false },
  { userId: "u4", venueId: "v2", attemptedAt: NOW - 20_000, succeeded: true  },
];

describe("Booking surge detection", () => {
  it("surgeWindowCount: v1 last 2 min = 4", () => {
    expect(surgeWindowCount(ATTEMPTS, "v1", 2 * 60_000, NOW)).toBe(4);
  });

  it("surgeWindowCount: v2 = 1", () => {
    expect(surgeWindowCount(ATTEMPTS, "v2", 2 * 60_000, NOW)).toBe(1);
  });

  it("isSurging: v1 with threshold 3 → true", () => {
    expect(isSurging(ATTEMPTS, "v1", 2 * 60_000, NOW, 3)).toBe(true);
  });

  it("isSurging: v2 with threshold 3 → false", () => {
    expect(isSurging(ATTEMPTS, "v2", 2 * 60_000, NOW, 3)).toBe(false);
  });

  it("perUserAttempts: u1 at v1 = 2", () => {
    expect(perUserAttempts(ATTEMPTS, "u1", "v1", 2 * 60_000, NOW)).toBe(2);
  });

  it("shouldRateLimit: u1 at limit of 2 → true", () => {
    expect(shouldRateLimit(ATTEMPTS, "u1", "v1", 2 * 60_000, NOW, 2)).toBe(true);
  });

  it("shouldRateLimit: u2 with 1 attempt below limit 2 → false", () => {
    expect(shouldRateLimit(ATTEMPTS, "u2", "v1", 2 * 60_000, NOW, 2)).toBe(false);
  });
});
