/**
 * Tests for push notification token refresh and invalidation.
 */

interface PushToken {
  token: string;
  userId: string;
  platform: "ios" | "android" | "web";
  registeredAt: number;
  lastRefreshedAt: number;
  isValid: boolean;
  failureCount: number;
}

function needsRefresh(token: PushToken, nowMs: number, maxAgeMs = 30 * 86_400_000): boolean {
  return token.isValid && nowMs - token.lastRefreshedAt > maxAgeMs;
}

function markInvalid(token: PushToken): PushToken {
  return { ...token, isValid: false };
}

function refreshToken(token: PushToken, newToken: string, nowMs: number): PushToken {
  return { ...token, token: newToken, lastRefreshedAt: nowMs, failureCount: 0, isValid: true };
}

function incrementFailure(token: PushToken, maxFailures = 3): PushToken {
  const newCount = token.failureCount + 1;
  return { ...token, failureCount: newCount, isValid: newCount < maxFailures };
}

function validTokensForUser(tokens: PushToken[], userId: string): PushToken[] {
  return tokens.filter((t) => t.userId === userId && t.isValid);
}

const NOW = 1_700_000_000_000;
const TOKEN: PushToken = {
  token: "tok-abc123", userId: "u1", platform: "ios",
  registeredAt: NOW - 60 * 86_400_000, lastRefreshedAt: NOW - 35 * 86_400_000,
  isValid: true, failureCount: 0,
};

describe("Push token refresh management", () => {
  it("needsRefresh: 35 days old > 30 days → true", () => {
    expect(needsRefresh(TOKEN, NOW)).toBe(true);
  });

  it("needsRefresh: recently refreshed → false", () => {
    const fresh = { ...TOKEN, lastRefreshedAt: NOW - 1000 };
    expect(needsRefresh(fresh, NOW)).toBe(false);
  });

  it("needsRefresh: invalid token → false (no need to refresh invalid)", () => {
    expect(needsRefresh({ ...TOKEN, isValid: false }, NOW)).toBe(false);
  });

  it("markInvalid: sets isValid false", () => {
    expect(markInvalid(TOKEN).isValid).toBe(false);
  });

  it("refreshToken: updates token and resets failures", () => {
    const failed = { ...TOKEN, failureCount: 2, isValid: false };
    const refreshed = refreshToken(failed, "new-tok", NOW);
    expect(refreshed.token).toBe("new-tok");
    expect(refreshed.failureCount).toBe(0);
    expect(refreshed.isValid).toBe(true);
  });

  it("incrementFailure: below max → still valid", () => {
    const t = incrementFailure(TOKEN);
    expect(t.failureCount).toBe(1);
    expect(t.isValid).toBe(true);
  });

  it("incrementFailure: at max → becomes invalid", () => {
    const twoFails = { ...TOKEN, failureCount: 2 };
    expect(incrementFailure(twoFails).isValid).toBe(false);
  });

  it("validTokensForUser: returns only valid tokens", () => {
    const tokens = [TOKEN, { ...TOKEN, userId: "u2" }, { ...TOKEN, isValid: false }];
    expect(validTokensForUser(tokens, "u1")).toHaveLength(1);
  });
});
