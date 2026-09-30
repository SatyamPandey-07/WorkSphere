/**
 * Tests for user password reset flow management.
 */

interface PasswordResetToken {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  requestIp: string;
}

function isTokenValid(reset: PasswordResetToken, nowMs: number): boolean {
  if (reset.usedAt !== null) return false; // already used
  return nowMs < reset.expiresAt;
}

function useToken(reset: PasswordResetToken, nowMs: number): PasswordResetToken {
  if (!isTokenValid(reset, nowMs)) throw new Error("Token invalid or expired");
  return { ...reset, usedAt: nowMs };
}

function tokenExpiresInMinutes(reset: PasswordResetToken, nowMs: number): number {
  if (!isTokenValid(reset, nowMs)) return 0;
  return Math.ceil((reset.expiresAt - nowMs) / 60_000);
}

function hasRecentReset(
  resets: PasswordResetToken[],
  userId: string,
  nowMs: number,
  cooldownMs = 5 * 60_000 // 5 minutes
): boolean {
  return resets.some(
    (r) => r.userId === userId && nowMs - r.createdAt < cooldownMs
  );
}

const NOW = 1_700_000_000_000;
const RESET: PasswordResetToken = {
  token: "abc123xyz", userId: "u1",
  createdAt: NOW - 60_000, expiresAt: NOW + 30 * 60_000, // 30 min from now
  usedAt: null, requestIp: "192.168.1.1",
};

describe("Password reset flow", () => {
  it("isTokenValid: not used and not expired → true", () => {
    expect(isTokenValid(RESET, NOW)).toBe(true);
  });

  it("isTokenValid: expired → false", () => {
    expect(isTokenValid(RESET, NOW + 35 * 60_000)).toBe(false);
  });

  it("isTokenValid: already used → false", () => {
    expect(isTokenValid({ ...RESET, usedAt: NOW - 1000 }, NOW)).toBe(false);
  });

  it("useToken: marks as used", () => {
    const used = useToken(RESET, NOW);
    expect(used.usedAt).toBe(NOW);
  });

  it("useToken: throws on expired token", () => {
    expect(() => useToken(RESET, NOW + 35 * 60_000)).toThrow("expired");
  });

  it("useToken: throws on already used", () => {
    const used = { ...RESET, usedAt: NOW - 1000 };
    expect(() => useToken(used, NOW)).toThrow();
  });

  it("tokenExpiresInMinutes: ~30 min remaining", () => {
    const remaining = tokenExpiresInMinutes(RESET, NOW);
    expect(remaining).toBe(30);
  });

  it("tokenExpiresInMinutes: expired → 0", () => {
    expect(tokenExpiresInMinutes(RESET, NOW + 35 * 60_000)).toBe(0);
  });

  it("hasRecentReset: reset within 5 min → true", () => {
    expect(hasRecentReset([RESET], "u1", NOW)).toBe(true);
  });

  it("hasRecentReset: reset older than 5 min → false", () => {
    const old = { ...RESET, createdAt: NOW - 10 * 60_000 };
    expect(hasRecentReset([old], "u1", NOW)).toBe(false);
  });
});
