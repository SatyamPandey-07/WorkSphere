/**
 * Tests for venue booking user session management utilities.
 */

interface UserSession {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
  ttlMs: number;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
}

function isSessionExpired(session: UserSession, nowMs: number): boolean {
  return !session.isActive || nowMs - session.lastActivityAt > session.ttlMs;
}

function sessionAge(session: UserSession, nowMs: number): number {
  return Math.floor((nowMs - session.createdAt) / 60_000); // minutes
}

function inactiveMinutes(session: UserSession, nowMs: number): number {
  return Math.floor((nowMs - session.lastActivityAt) / 60_000);
}

function activeSessions(sessions: UserSession[], nowMs: number): UserSession[] {
  return sessions.filter((s) => !isSessionExpired(s, nowMs));
}

function uniqueActiveUsers(sessions: UserSession[], nowMs: number): number {
  return new Set(activeSessions(sessions, nowMs).map((s) => s.userId)).size;
}

function concurrentSessionsPerUser(sessions: UserSession[], userId: string, nowMs: number): number {
  return sessions.filter((s) => s.userId === userId && !isSessionExpired(s, nowMs)).length;
}

function sessionsByDevice(sessions: UserSession[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    const device = s.userAgent.includes("Mobile") ? "mobile" : "desktop";
    counts[device] = (counts[device] ?? 0) + 1;
  }
  return counts;
}

const NOW = 1_700_000_000_000;
const TTL = 30 * 60_000; // 30 minutes
const SESSIONS: UserSession[] = [
  { sessionId: "s1", userId: "u1", createdAt: NOW - 20 * 60_000, lastActivityAt: NOW - 5  * 60_000, ttlMs: TTL, ipAddress: "1.2.3.4", userAgent: "Chrome Desktop", isActive: true },
  { sessionId: "s2", userId: "u2", createdAt: NOW - 40 * 60_000, lastActivityAt: NOW - 35 * 60_000, ttlMs: TTL, ipAddress: "5.6.7.8", userAgent: "Safari Mobile",  isActive: true },
  { sessionId: "s3", userId: "u1", createdAt: NOW - 10 * 60_000, lastActivityAt: NOW - 2  * 60_000, ttlMs: TTL, ipAddress: "1.2.3.4", userAgent: "Chrome Mobile",  isActive: true },
];

describe("User session management", () => {
  it("isSessionExpired: s2 inactive 35min > 30min TTL → expired", () => {
    expect(isSessionExpired(SESSIONS[1], NOW)).toBe(true);
  });

  it("isSessionExpired: s1 inactive 5min < 30min TTL → active", () => {
    expect(isSessionExpired(SESSIONS[0], NOW)).toBe(false);
  });

  it("activeSessions: 2 active sessions", () => {
    expect(activeSessions(SESSIONS, NOW).length).toBe(2);
  });

  it("uniqueActiveUsers: u1 has 2 active sessions → 1 unique", () => {
    expect(uniqueActiveUsers(SESSIONS, NOW)).toBe(1);
  });

  it("concurrentSessionsPerUser: u1 has 2 concurrent", () => {
    expect(concurrentSessionsPerUser(SESSIONS, "u1", NOW)).toBe(2);
  });

  it("sessionsByDevice: 1 desktop, 2 mobile", () => {
    const by = sessionsByDevice(SESSIONS);
    expect(by.desktop).toBe(1);
    expect(by.mobile).toBe(2);
  });
});
