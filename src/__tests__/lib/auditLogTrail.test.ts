/**
 * Tests for audit log trail recording and querying.
 */

type AuditAction =
  | "venue.create"
  | "venue.update"
  | "booking.create"
  | "booking.cancel"
  | "user.login"
  | "user.logout";

interface AuditEntry {
  id: string;
  actorId: string;
  action: AuditAction;
  resourceId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

function logEntry(
  actorId: string,
  action: AuditAction,
  resourceId: string,
  timestamp: number,
  metadata?: Record<string, unknown>
): AuditEntry {
  return { id: `${actorId}-${timestamp}`, actorId, action, resourceId, timestamp, metadata };
}

function entriesForResource(logs: AuditEntry[], resourceId: string): AuditEntry[] {
  return logs.filter((e) => e.resourceId === resourceId).sort((a, b) => a.timestamp - b.timestamp);
}

function entriesByActor(logs: AuditEntry[], actorId: string): AuditEntry[] {
  return logs.filter((e) => e.actorId === actorId);
}

function recentEntries(logs: AuditEntry[], limitMs: number, nowMs: number): AuditEntry[] {
  return logs.filter((e) => nowMs - e.timestamp <= limitMs).sort((a, b) => b.timestamp - a.timestamp);
}

const NOW = 1_700_000_000_000;
const LOGS: AuditEntry[] = [
  { id: "e1", actorId: "admin", action: "venue.create", resourceId: "v1", timestamp: NOW - 3000 },
  { id: "e2", actorId: "u1",    action: "booking.create", resourceId: "b1", timestamp: NOW - 2000 },
  { id: "e3", actorId: "admin", action: "venue.update", resourceId: "v1", timestamp: NOW - 1000 },
  { id: "e4", actorId: "u2",    action: "user.login",  resourceId: "u2", timestamp: NOW - 500   },
];

describe("Audit log trail", () => {
  it("logEntry creates entry with correct fields", () => {
    const entry = logEntry("admin", "venue.create", "v1", NOW);
    expect(entry.actorId).toBe("admin");
    expect(entry.action).toBe("venue.create");
    expect(entry.resourceId).toBe("v1");
  });

  it("entriesForResource returns sorted entries", () => {
    const entries = entriesForResource(LOGS, "v1");
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("venue.create");
  });

  it("entriesForResource: unknown resource → empty", () => {
    expect(entriesForResource(LOGS, "x99")).toHaveLength(0);
  });

  it("entriesByActor: admin has 2 entries", () => {
    expect(entriesByActor(LOGS, "admin")).toHaveLength(2);
  });

  it("recentEntries within window sorted descending", () => {
    const recent = recentEntries(LOGS, 3000, NOW);
    expect(recent).toHaveLength(3); // 3000, 2000, 1000
    expect(recent[0].timestamp).toBeGreaterThan(recent[1].timestamp);
  });

  it("recentEntries: very short window → few entries", () => {
    const recent = recentEntries(LOGS, 600, NOW);
    expect(recent).toHaveLength(1);
  });
});
