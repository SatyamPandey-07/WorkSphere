/**
 * Tests for venue booking calendar sync and conflict resolution.
 */

interface CalendarEvent {
  id: string;
  externalId: string;
  source: "google" | "outlook" | "apple" | "internal";
  title: string;
  startMs: number;
  endMs: number;
  venueId: string;
  isBlocked: boolean;
}

interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  conflicts: string[];
}

function eventDurationHours(event: CalendarEvent): number {
  return Math.round((event.endMs - event.startMs) / 3_600_000 * 10) / 10;
}

function eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.venueId === b.venueId && a.startMs < b.endMs && b.startMs < a.endMs;
}

function findConflicts(events: CalendarEvent[]): [CalendarEvent, CalendarEvent][] {
  const conflicts: [CalendarEvent, CalendarEvent][] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (eventsOverlap(events[i], events[j])) {
        conflicts.push([events[i], events[j]]);
      }
    }
  }
  return conflicts;
}

function blockedPeriods(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => e.isBlocked);
}

function eventsBySource(events: CalendarEvent[]): Record<CalendarEvent["source"], number> {
  const counts: Partial<Record<CalendarEvent["source"], number>> = {};
  for (const e of events) counts[e.source] = (counts[e.source] ?? 0) + 1;
  return counts as Record<CalendarEvent["source"], number>;
}

function isAvailable(
  venueId: string,
  startMs: number,
  endMs: number,
  events: CalendarEvent[]
): boolean {
  const query: CalendarEvent = { id: "q", externalId: "q", source: "internal", title: "", startMs, endMs, venueId, isBlocked: false };
  return !events.some((e) => eventsOverlap(query, e));
}

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const EVENTS: CalendarEvent[] = [
  { id: "e1", externalId: "gc1", source: "google",   title: "Corp Offsite",  startMs: NOW,          endMs: NOW + 4 * HOUR, venueId: "v1", isBlocked: false },
  { id: "e2", externalId: "ol1", source: "outlook",  title: "Team Meeting",  startMs: NOW + 2*HOUR, endMs: NOW + 6 * HOUR, venueId: "v1", isBlocked: false },
  { id: "e3", externalId: "bl1", source: "internal", title: "Maintenance",   startMs: NOW + 8*HOUR, endMs: NOW + 12* HOUR, venueId: "v1", isBlocked: true },
];

describe("Calendar sync and conflict resolution", () => {
  it("eventDurationHours: 4h event = 4", () => {
    expect(eventDurationHours(EVENTS[0])).toBe(4);
  });

  it("eventsOverlap: e1 and e2 overlap → true", () => {
    expect(eventsOverlap(EVENTS[0], EVENTS[1])).toBe(true);
  });

  it("eventsOverlap: e1 and e3 don't overlap → false", () => {
    expect(eventsOverlap(EVENTS[0], EVENTS[2])).toBe(false);
  });

  it("findConflicts: 1 conflict between e1 and e2", () => {
    expect(findConflicts(EVENTS).length).toBe(1);
  });

  it("blockedPeriods: 1 blocked period", () => {
    expect(blockedPeriods(EVENTS).length).toBe(1);
  });

  it("isAvailable: slot after all events → available", () => {
    expect(isAvailable("v1", NOW + 13 * HOUR, NOW + 15 * HOUR, EVENTS)).toBe(true);
  });

  it("isAvailable: slot overlapping e1 → not available", () => {
    expect(isAvailable("v1", NOW + HOUR, NOW + 3 * HOUR, EVENTS)).toBe(false);
  });
});
