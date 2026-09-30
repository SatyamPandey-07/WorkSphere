/**
 * Tests for multi-device user session management.
 */

interface UserSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  ipAddress: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

function isSessionActive(session: UserSession, nowMs: number): boolean {
  return nowMs < session.expiresAt;
}

function isStaleSession(session: UserSession, nowMs: number, idleMs = 7 * 86_400_000): boolean {
  return nowMs - session.lastActiveAt > idleMs;
}

function revokeSession(session: UserSession): UserSession {
  return { ...session, expiresAt: 0 };
}

function activeSessionsForUser(sessions: UserSession[], userId: string, nowMs: number): UserSession[] {
  return sessions.filter((s) => s.userId === userId && isSessionActive(s, nowMs));
}

function revokeAllExcept(
  sessions: UserSession[],
  userId: string,
  currentSessionId: string
): UserSession[] {
  return sessions.map((s) =>
    s.userId === userId && s.sessionId !== currentSessionId
      ? revokeSession(s)
      : s
  );
}

const NOW = 1_700_000_000_000;
const SESSIONS: UserSession[] = [
  { sessionId: "s1", userId: "u1", deviceId: "d1", deviceName: "iPhone", ipAddress: "1.1.1.1", createdAt: NOW - 3600_000, lastActiveAt: NOW - 1000, expiresAt: NOW + 86_400_000, isCurrent: true  },
  { sessionId: "s2", userId: "u1", deviceId: "d2", deviceName: "Chrome", ipAddress: "2.2.2.2", createdAt: NOW - 86400_000, lastActiveAt: NOW - 10 * 86_400_000, expiresAt: NOW + 86_400_000, isCurrent: false },
  { sessionId: "s3", userId: "u2", deviceId: "d3", deviceName: "Safari", ipAddress: "3.3.3.3", createdAt: NOW - 100, lastActiveAt: NOW - 100, expiresAt: NOW + 86_400_000, isCurrent: false },
];

describe("Multi-device session management", () => {
  it("isSessionActive: not expired → true", () => {
    expect(isSessionActive(SESSIONS[0], NOW)).toBe(true);
  });

  it("isSessionActive: expired → false", () => {
    expect(isSessionActive({ ...SESSIONS[0], expiresAt: NOW - 1 }, NOW)).toBe(false);
  });

  it("isStaleSession: inactive for 10 days → stale", () => {
    expect(isStaleSession(SESSIONS[1], NOW)).toBe(true);
  });

  it("isStaleSession: recently active → not stale", () => {
    expect(isStaleSession(SESSIONS[0], NOW)).toBe(false);
  });

  it("revokeSession: sets expiresAt to 0", () => {
    expect(revokeSession(SESSIONS[0]).expiresAt).toBe(0);
  });

  it("activeSessionsForUser: u1 has 2 active", () => {
    expect(activeSessionsForUser(SESSIONS, "u1", NOW)).toHaveLength(2);
  });

  it("revokeAllExcept: keeps current, revokes others", () => {
    const result = revokeAllExcept(SESSIONS, "u1", "s1");
    expect(result.find((s) => s.sessionId === "s1")!.expiresAt).toBeGreaterThan(0);
    expect(result.find((s) => s.sessionId === "s2")!.expiresAt).toBe(0);
  });

  it("revokeAllExcept: u2 sessions unaffected", () => {
    const result = revokeAllExcept(SESSIONS, "u1", "s1");
    expect(result.find((s) => s.sessionId === "s3")!.expiresAt).toBeGreaterThan(0);
  });
});
