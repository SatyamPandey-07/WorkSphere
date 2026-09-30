/**
 * Tests for venue booking security audit trail.
 */

type SecurityEventType = "login" | "failed_login" | "password_change" | "booking_created" | "payment_processed" | "data_export" | "admin_action";

interface SecurityEvent {
  eventId: string;
  userId: string;
  type: SecurityEventType;
  ipAddress: string;
  userAgent: string;
  timestamp: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  details: Record<string, string>;
}

function anomalyScore(events: SecurityEvent[], userId: string, nowMs: number): number {
  const recent = events.filter((e) => e.userId === userId && nowMs - e.timestamp <= 3600_000);
  const failedLogins = recent.filter((e) => e.type === "failed_login").length;
  const uniqueIps = new Set(recent.map((e) => e.ipAddress)).size;
  const criticals = recent.filter((e) => e.riskLevel === "critical").length;
  return Math.min(100, failedLogins * 15 + (uniqueIps > 2 ? uniqueIps * 5 : 0) + criticals * 30);
}

function suspiciousActivity(events: SecurityEvent[], threshold = 50): SecurityEvent[] {
  const userEvents: Record<string, SecurityEvent[]> = {};
  events.forEach((e) => {
    if (!userEvents[e.userId]) userEvents[e.userId] = [];
    userEvents[e.userId].push(e);
  });

  const suspicious: SecurityEvent[] = [];
  for (const [, userEvts] of Object.entries(userEvents)) {
    const score = anomalyScore(userEvts, userEvts[0].userId, Math.max(...userEvts.map((e) => e.timestamp)));
    if (score >= threshold) suspicious.push(...userEvts);
  }
  return suspicious;
}

function failedLoginAttempts(events: SecurityEvent[], userId: string, windowMs: number, nowMs: number): number {
  return events.filter(
    (e) => e.userId === userId && e.type === "failed_login" && nowMs - e.timestamp <= windowMs
  ).length;
}

function isAccountLocked(events: SecurityEvent[], userId: string, nowMs: number, maxAttempts = 5): boolean {
  return failedLoginAttempts(events, userId, 3600_000, nowMs) >= maxAttempts;
}

const NOW = 1_700_000_000_000;
const SEC_EVENTS: SecurityEvent[] = [
  { eventId: "e1", userId: "u1", type: "failed_login", ipAddress: "1.1.1.1", userAgent: "browser", timestamp: NOW - 3000, riskLevel: "medium", details: {} },
  { eventId: "e2", userId: "u1", type: "failed_login", ipAddress: "1.1.1.2", userAgent: "browser", timestamp: NOW - 2000, riskLevel: "medium", details: {} },
  { eventId: "e3", userId: "u1", type: "failed_login", ipAddress: "1.1.1.3", userAgent: "browser", timestamp: NOW - 1000, riskLevel: "high",   details: {} },
  { eventId: "e4", userId: "u2", type: "login",        ipAddress: "2.2.2.2", userAgent: "mobile",  timestamp: NOW - 500,  riskLevel: "low",    details: {} },
];

describe("Venue booking security audit", () => {
  it("anomalyScore: 3 failed logins + 3 unique IPs → high score", () => {
    const score = anomalyScore(SEC_EVENTS, "u1", NOW);
    expect(score).toBeGreaterThan(30);
  });

  it("anomalyScore: clean user → 0", () => {
    expect(anomalyScore(SEC_EVENTS, "u2", NOW)).toBe(0);
  });

  it("failedLoginAttempts: u1 has 3 in last hour", () => {
    expect(failedLoginAttempts(SEC_EVENTS, "u1", 3600_000, NOW)).toBe(3);
  });

  it("isAccountLocked: 3 attempts < 5 threshold → false", () => {
    expect(isAccountLocked(SEC_EVENTS, "u1", NOW)).toBe(false);
  });

  it("isAccountLocked: 5 attempts → true", () => {
    const moreAttempts = [
      ...SEC_EVENTS,
      { ...SEC_EVENTS[0], eventId: "e5", timestamp: NOW - 800 },
      { ...SEC_EVENTS[0], eventId: "e6", timestamp: NOW - 600 },
    ];
    expect(isAccountLocked(moreAttempts, "u1", NOW)).toBe(true);
  });
});
