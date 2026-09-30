/**
 * Tests for venue booking audit trail for compliance.
 */

type AuditAction = "create" | "modify" | "cancel" | "check_in" | "check_out" | "refund";

interface BookingAuditEntry {
  entryId: string;
  bookingId: string;
  action: AuditAction;
  actorId: string;
  actorType: "user" | "admin" | "system";
  timestamp: number;
  changes: Record<string, { before: unknown; after: unknown }>;
  ipAddress?: string;
}

function auditTrailForBooking(
  entries: BookingAuditEntry[],
  bookingId: string
): BookingAuditEntry[] {
  return entries
    .filter((e) => e.bookingId === bookingId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function lastModification(entries: BookingAuditEntry[], bookingId: string): BookingAuditEntry | null {
  const bookingEntries = entries.filter(
    (e) => e.bookingId === bookingId && e.action === "modify"
  );
  if (bookingEntries.length === 0) return null;
  return bookingEntries.reduce((latest, e) => e.timestamp > latest.timestamp ? e : latest);
}

function hasAdminIntervention(entries: BookingAuditEntry[], bookingId: string): boolean {
  return entries.some((e) => e.bookingId === bookingId && e.actorType === "admin");
}

function changedFields(entry: BookingAuditEntry): string[] {
  return Object.keys(entry.changes);
}

function auditSummary(entries: BookingAuditEntry[], bookingId: string): Record<AuditAction, number> {
  const summary: Record<AuditAction, number> = { create: 0, modify: 0, cancel: 0, check_in: 0, check_out: 0, refund: 0 };
  entries.filter((e) => e.bookingId === bookingId).forEach((e) => summary[e.action]++);
  return summary;
}

const NOW = 1_700_000_000_000;
const ENTRIES: BookingAuditEntry[] = [
  { entryId: "ae1", bookingId: "b1", action: "create",   actorId: "u1", actorType: "user",   timestamp: NOW - 7200_000, changes: {} },
  { entryId: "ae2", bookingId: "b1", action: "modify",   actorId: "u1", actorType: "user",   timestamp: NOW - 3600_000, changes: { startTime: { before: "09:00", after: "10:00" } } },
  { entryId: "ae3", bookingId: "b1", action: "modify",   actorId: "admin1", actorType: "admin", timestamp: NOW - 1800_000, changes: { price: { before: 1000, after: 800 } } },
  { entryId: "ae4", bookingId: "b2", action: "create",   actorId: "u2", actorType: "user",   timestamp: NOW - 1000, changes: {} },
];

describe("Venue booking audit trail", () => {
  it("auditTrailForBooking: b1 has 3 entries sorted by time", () => {
    const trail = auditTrailForBooking(ENTRIES, "b1");
    expect(trail).toHaveLength(3);
    expect(trail[0].action).toBe("create");
  });

  it("lastModification: most recent modify for b1", () => {
    const last = lastModification(ENTRIES, "b1");
    expect(last!.entryId).toBe("ae3");
  });

  it("lastModification: no modifies → null", () => {
    expect(lastModification(ENTRIES, "b2")).toBeNull();
  });

  it("hasAdminIntervention: b1 had admin → true", () => {
    expect(hasAdminIntervention(ENTRIES, "b1")).toBe(true);
  });

  it("hasAdminIntervention: b2 no admin → false", () => {
    expect(hasAdminIntervention(ENTRIES, "b2")).toBe(false);
  });

  it("changedFields: ae2 changed startTime", () => {
    expect(changedFields(ENTRIES[1])).toContain("startTime");
  });

  it("auditSummary: b1 has 1 create and 2 modifies", () => {
    const summary = auditSummary(ENTRIES, "b1");
    expect(summary.create).toBe(1);
    expect(summary.modify).toBe(2);
  });
});
