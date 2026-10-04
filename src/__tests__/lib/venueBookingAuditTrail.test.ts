/**
 * Tests for venue booking audit trail and change log utilities.
 */

type AuditAction = "create" | "update" | "delete" | "view" | "export" | "approve" | "reject";
type AuditResourceType = "booking" | "venue" | "user" | "payment" | "review" | "contract";

interface AuditEvent {
  id: string;
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  timestamp: number;
  ipAddress: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  metadata: Record<string, string>;
}

function auditSummary(events: AuditEvent[]): Record<AuditAction, number> {
  const summary: Partial<Record<AuditAction, number>> = {};
  for (const e of events) summary[e.action] = (summary[e.action] ?? 0) + 1;
  return summary as Record<AuditAction, number>;
}

function eventsForResource(
  events: AuditEvent[],
  resourceType: AuditResourceType,
  resourceId: string
): AuditEvent[] {
  return events.filter((e) => e.resourceType === resourceType && e.resourceId === resourceId);
}

function sensitiveActionCount(events: AuditEvent[]): number {
  const sensitiveActions: AuditAction[] = ["delete", "export", "approve", "reject"];
  return events.filter((e) => sensitiveActions.includes(e.action)).length;
}

function userActivityCount(events: AuditEvent[], userId: string): number {
  return events.filter((e) => e.userId === userId).length;
}

function changedFields(event: AuditEvent): string[] {
  return event.changes.map((c) => c.field);
}

function recentEvents(events: AuditEvent[], nowMs: number, windowMs = 86_400_000): AuditEvent[] {
  return events.filter((e) => nowMs - e.timestamp <= windowMs);
}

const NOW = 1_700_000_000_000;
const EVENTS: AuditEvent[] = [
  { id: "a1", userId: "u1", action: "create",  resourceType: "booking", resourceId: "b1", timestamp: NOW - 1000,        ipAddress: "1.1.1.1", changes: [],                                                            metadata: {} },
  { id: "a2", userId: "u1", action: "update",  resourceType: "booking", resourceId: "b1", timestamp: NOW - 500,         ipAddress: "1.1.1.1", changes: [{ field: "guestCount", oldValue: 50, newValue: 60 }],        metadata: {} },
  { id: "a3", userId: "u2", action: "approve", resourceType: "booking", resourceId: "b1", timestamp: NOW - 100,         ipAddress: "2.2.2.2", changes: [],                                                            metadata: {} },
  { id: "a4", userId: "u1", action: "delete",  resourceType: "review",  resourceId: "r1", timestamp: NOW - 90000_000,   ipAddress: "1.1.1.1", changes: [],                                                            metadata: {} },
];

describe("Audit trail management", () => {
  it("auditSummary: counts actions correctly", () => {
    const summary = auditSummary(EVENTS);
    expect(summary.create).toBe(1);
    expect(summary.update).toBe(1);
  });

  it("eventsForResource: 3 events for booking b1", () => {
    expect(eventsForResource(EVENTS, "booking", "b1").length).toBe(3);
  });

  it("sensitiveActionCount: approve + delete = 2", () => {
    expect(sensitiveActionCount(EVENTS)).toBe(2);
  });

  it("userActivityCount: u1 has 3 events", () => {
    expect(userActivityCount(EVENTS, "u1")).toBe(3);
  });

  it("changedFields: update event changed guestCount", () => {
    expect(changedFields(EVENTS[1])).toContain("guestCount");
  });

  it("recentEvents: 3 events in last 24h", () => {
    expect(recentEvents(EVENTS, NOW).length).toBe(3);
  });
});
