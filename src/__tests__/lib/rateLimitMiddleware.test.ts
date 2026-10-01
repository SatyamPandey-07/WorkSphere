/**
 * Tests for the in-memory rate limiter fallback logic.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memStore = new Map<string, RateLimitEntry>();

function memRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = memStore.get(identifier);

  if (!entry || now >= entry.resetTime) {
    memStore.set(identifier, { count: 1, resetTime: now + windowMs });
    return true; // allowed
  }

  if (entry.count >= limit) {
    return false; // rate limited
  }

  entry.count++;
  return true;
}

beforeEach(() => {
  memStore.clear();
});

describe("In-memory rate limiter", () => {
  it("allows first request", () => {
    expect(memRateLimit("user-1", 5, 60000)).toBe(true);
  });

  it("allows up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(memRateLimit("user-1", 5, 60000)).toBe(true);
    }
  });

  it("blocks request exceeding the limit", () => {
    for (let i = 0; i < 5; i++) {
      memRateLimit("user-1", 5, 60000);
    }
    expect(memRateLimit("user-1", 5, 60000)).toBe(false);
  });

  it("different identifiers are independent", () => {
    for (let i = 0; i < 5; i++) {
      memRateLimit("user-1", 5, 60000);
    }
    // user-2 should still be allowed
    expect(memRateLimit("user-2", 5, 60000)).toBe(true);
  });

  it("limit=1 allows first, blocks second", () => {
    expect(memRateLimit("user-3", 1, 60000)).toBe(true);
    expect(memRateLimit("user-3", 1, 60000)).toBe(false);
  });

  it("resets after window expires", () => {
    memStore.set("user-4", { count: 5, resetTime: Date.now() - 1 }); // expired
    expect(memRateLimit("user-4", 5, 60000)).toBe(true); // reset
  });
});
