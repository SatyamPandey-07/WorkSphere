/**
 * Tests for workspace session log entry management.
 */

interface SessionLog {
  sessionId: string;
  userId: string;
  venueId: string;
  startedAt: number;
  endedAt: number | null;
  deviceInfo: string;
}

function isActive(session: SessionLog, nowMs: number): boolean {
  return session.endedAt === null || nowMs < session.endedAt;
}

function sessionDurationMs(session: SessionLog, nowMs: number): number {
  const end = session.endedAt ?? nowMs;
  return end - session.startedAt;
}

function endSession(session: SessionLog, nowMs: number): SessionLog {
  return { ...session, endedAt: nowMs };
}

function activeSessions(logs: SessionLog[], userId: string, nowMs: number): SessionLog[] {
  return logs.filter((s) => s.userId === userId && isActive(s, nowMs));
}

function totalSessionTime(logs: SessionLog[], userId: string, nowMs: number): number {
  return logs
    .filter((s) => s.userId === userId)
    .reduce((sum, s) => sum + sessionDurationMs(s, nowMs), 0);
}

const NOW = 1_700_000_000_000;
const SESSIONS: SessionLog[] = [
  { sessionId: "s1", userId: "u1", venueId: "v1", startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, deviceInfo: "Chrome" },
  { sessionId: "s2", userId: "u1", venueId: "v2", startedAt: NOW - 1800_000, endedAt: null, deviceInfo: "Firefox" },
  { sessionId: "s3", userId: "u2", venueId: "v1", startedAt: NOW - 600_000,  endedAt: null, deviceInfo: "Safari"  },
];

describe("Workspace session logs", () => {
  it("isActive: null endedAt → active", () => {
    expect(isActive(SESSIONS[1], NOW)).toBe(true);
  });

  it("isActive: ended session → inactive", () => {
    expect(isActive(SESSIONS[0], NOW)).toBe(false);
  });

  it("sessionDurationMs: ended = endedAt - startedAt", () => {
    expect(sessionDurationMs(SESSIONS[0], NOW)).toBe(3_600_000);
  });

  it("sessionDurationMs: active uses nowMs", () => {
    expect(sessionDurationMs(SESSIONS[1], NOW)).toBe(1_800_000);
  });

  it("endSession sets endedAt", () => {
    const ended = endSession(SESSIONS[1], NOW);
    expect(ended.endedAt).toBe(NOW);
  });

  it("endSession is immutable", () => {
    endSession(SESSIONS[1], NOW);
    expect(SESSIONS[1].endedAt).toBeNull();
  });

  it("activeSessions: u1 has 1 active", () => {
    expect(activeSessions(SESSIONS, "u1", NOW)).toHaveLength(1);
  });

  it("activeSessions: u2 has 1 active", () => {
    expect(activeSessions(SESSIONS, "u2", NOW)).toHaveLength(1);
  });

  it("totalSessionTime: u1 = 3600000 + 1800000 = 5400000 ms", () => {
    expect(totalSessionTime(SESSIONS, "u1", NOW)).toBe(5_400_000);
  });
});
