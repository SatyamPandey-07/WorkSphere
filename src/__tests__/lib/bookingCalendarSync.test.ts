/**
 * Tests for booking to calendar event synchronization.
 */

interface BookingCalendarEvent {
  bookingId: string;
  calendarEventId?: string;
  lastSyncedAt: number | null;
  syncStatus: "pending" | "synced" | "failed" | "deleted";
}

function needsSync(event: BookingCalendarEvent, nowMs: number, maxAgeMs = 3_600_000): boolean {
  if (event.syncStatus === "deleted") return false;
  if (event.syncStatus === "pending") return true;
  if (event.syncStatus === "failed")  return true;
  if (!event.lastSyncedAt) return true;
  return nowMs - event.lastSyncedAt > maxAgeMs;
}

function markSynced(event: BookingCalendarEvent, calendarEventId: string, nowMs: number): BookingCalendarEvent {
  return { ...event, calendarEventId, syncStatus: "synced", lastSyncedAt: nowMs };
}

function markFailed(event: BookingCalendarEvent): BookingCalendarEvent {
  return { ...event, syncStatus: "failed" };
}

function markDeleted(event: BookingCalendarEvent): BookingCalendarEvent {
  return { ...event, syncStatus: "deleted" };
}

const NOW = 1_700_000_000_000;
const PENDING: BookingCalendarEvent = { bookingId: "b1", syncStatus: "pending", lastSyncedAt: null };
const SYNCED:  BookingCalendarEvent = { bookingId: "b2", calendarEventId: "cal1", syncStatus: "synced", lastSyncedAt: NOW - 1000 };
const STALE:   BookingCalendarEvent = { bookingId: "b3", calendarEventId: "cal2", syncStatus: "synced", lastSyncedAt: NOW - 7_200_000 };

describe("Booking calendar sync", () => {
  it("needsSync: pending → true", () => {
    expect(needsSync(PENDING, NOW)).toBe(true);
  });

  it("needsSync: recently synced → false", () => {
    expect(needsSync(SYNCED, NOW)).toBe(false);
  });

  it("needsSync: stale sync → true", () => {
    expect(needsSync(STALE, NOW)).toBe(true);
  });

  it("needsSync: deleted → false", () => {
    const deleted = { ...PENDING, syncStatus: "deleted" as const };
    expect(needsSync(deleted, NOW)).toBe(false);
  });

  it("markSynced sets calendarEventId and status", () => {
    const synced = markSynced(PENDING, "cal-new", NOW);
    expect(synced.syncStatus).toBe("synced");
    expect(synced.calendarEventId).toBe("cal-new");
    expect(synced.lastSyncedAt).toBe(NOW);
  });

  it("markFailed sets status to failed", () => {
    expect(markFailed(PENDING).syncStatus).toBe("failed");
  });

  it("markDeleted sets status to deleted", () => {
    expect(markDeleted(SYNCED).syncStatus).toBe("deleted");
  });

  it("all state transitions are immutable", () => {
    markSynced(PENDING, "x", NOW);
    expect(PENDING.syncStatus).toBe("pending");
    markFailed(PENDING);
    expect(PENDING.syncStatus).toBe("pending");
  });
});
