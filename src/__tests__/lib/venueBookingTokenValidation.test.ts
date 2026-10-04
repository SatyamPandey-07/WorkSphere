/**
 * Tests for venue booking access token validation utilities.
 */

interface AccessToken {
  token: string;
  userId: string;
  scope: string[];
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  clientId: string;
}

function isTokenExpired(token: AccessToken, nowMs: number): boolean {
  return nowMs >= token.expiresAt;
}

function isTokenValid(token: AccessToken, nowMs: number): boolean {
  if (token.revoked) return false;
  if (isTokenExpired(token, nowMs)) return false;
  return true;
}

function hasScope(token: AccessToken, requiredScope: string): boolean {
  return token.scope.includes(requiredScope) || token.scope.includes("*");
}

function hasAllScopes(token: AccessToken, required: string[]): boolean {
  return required.every((s) => hasScope(token, s));
}

function tokenAgeSeconds(token: AccessToken, nowMs: number): number {
  return Math.floor((nowMs - token.issuedAt) / 1000);
}

function remainingLifeSeconds(token: AccessToken, nowMs: number): number {
  return Math.max(0, Math.floor((token.expiresAt - nowMs) / 1000));
}

const NOW = 1_700_000_000_000;
const TOKEN: AccessToken = {
  token: "tok_abc123",
  userId: "u1",
  scope: ["bookings:read", "bookings:write", "venues:read"],
  issuedAt: NOW - 1800_000,  // 30 min ago
  expiresAt: NOW + 1800_000, // 30 min from now
  revoked: false,
  clientId: "app-web",
};

describe("Access token validation", () => {
  it("isTokenExpired: future expiry → false", () => {
    expect(isTokenExpired(TOKEN, NOW)).toBe(false);
  });

  it("isTokenExpired: past expiry → true", () => {
    expect(isTokenExpired(TOKEN, NOW + 7200_000)).toBe(true);
  });

  it("isTokenValid: not revoked, not expired → true", () => {
    expect(isTokenValid(TOKEN, NOW)).toBe(true);
  });

  it("isTokenValid: revoked → false", () => {
    expect(isTokenValid({ ...TOKEN, revoked: true }, NOW)).toBe(false);
  });

  it("hasScope: bookings:read → true", () => {
    expect(hasScope(TOKEN, "bookings:read")).toBe(true);
  });

  it("hasScope: admin:delete → false", () => {
    expect(hasScope(TOKEN, "admin:delete")).toBe(false);
  });

  it("hasAllScopes: bookings:read + venues:read → true", () => {
    expect(hasAllScopes(TOKEN, ["bookings:read", "venues:read"])).toBe(true);
  });

  it("remainingLifeSeconds: ~1800s remaining", () => {
    expect(remainingLifeSeconds(TOKEN, NOW)).toBe(1800);
  });
});
