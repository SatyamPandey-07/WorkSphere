/**
 * Tests for user session expiry / token TTL logic.
 */

interface Session {
  userId: string;
  issuedAt: number;  // ms timestamp
  expiresAt: number; // ms timestamp
}

function isExpired(session: Session, nowMs = Date.now()): boolean {
  return nowMs >= session.expiresAt;
}

function remainingMs(session: Session, nowMs = Date.now()): number {
  return Math.max(0, session.expiresAt - nowMs);
}

function refreshSession(session: Session, ttlMs: number, nowMs = Date.now()): Session {
  return { ...session, issuedAt: nowMs, expiresAt: nowMs + ttlMs };
}

const BASE = 1_700_000_000_000; // fixed "now" for deterministic tests

describe("User session expiry", () => {
  const valid:   Session = { userId: "u1", issuedAt: BASE, expiresAt: BASE + 3_600_000 };
  const expired: Session = { userId: "u2", issuedAt: BASE - 7200_000, expiresAt: BASE - 1 };

  it("active session not expired", () => {
    expect(isExpired(valid, BASE + 1000)).toBe(false);
  });

  it("past expiry is expired", () => {
    expect(isExpired(expired, BASE)).toBe(true);
  });

  it("exactly at expiry is expired", () => {
    const s: Session = { userId: "u3", issuedAt: BASE, expiresAt: BASE + 1000 };
    expect(isExpired(s, BASE + 1000)).toBe(true);
  });

  it("remainingMs positive for live session", () => {
    expect(remainingMs(valid, BASE + 1000)).toBe(3_599_000);
  });

  it("remainingMs clamps to 0 for expired", () => {
    expect(remainingMs(expired, BASE)).toBe(0);
  });

  it("refreshSession extends expiry", () => {
    const refreshed = refreshSession(valid, 3_600_000, BASE + 100_000);
    expect(refreshed.expiresAt).toBe(BASE + 100_000 + 3_600_000);
  });

  it("refreshSession updates issuedAt", () => {
    const refreshed = refreshSession(valid, 3_600_000, BASE + 200_000);
    expect(refreshed.issuedAt).toBe(BASE + 200_000);
  });

  it("refreshSession preserves userId", () => {
    const refreshed = refreshSession(valid, 1000, BASE);
    expect(refreshed.userId).toBe("u1");
  });
});
