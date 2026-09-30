/**
 * Tests for venue event calendar and scheduling logic.
 */

type EventType = "workshop" | "networking" | "coworking_day" | "webinar";

interface VenueEvent {
  id: string;
  venueId: string;
  type: EventType;
  title: string;
  startMs: number;
  endMs: number;
  maxAttendees: number;
  registeredCount: number;
}

function isFull(event: VenueEvent): boolean {
  return event.registeredCount >= event.maxAttendees;
}

function hasAvailableSpots(event: VenueEvent): boolean {
  return event.registeredCount < event.maxAttendees;
}

function spotsRemaining(event: VenueEvent): number {
  return Math.max(0, event.maxAttendees - event.registeredCount);
}

function upcomingEvents(
  events: VenueEvent[],
  venueId: string,
  nowMs: number
): VenueEvent[] {
  return events
    .filter((e) => e.venueId === venueId && e.startMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs);
}

function register(event: VenueEvent): VenueEvent {
  if (isFull(event)) throw new Error("Event is full");
  return { ...event, registeredCount: event.registeredCount + 1 };
}

const NOW = 1_700_000_000_000;
const EVENTS: VenueEvent[] = [
  { id: "e1", venueId: "v1", type: "workshop",    title: "Tech Talk",    startMs: NOW + 3600_000, endMs: NOW + 7200_000, maxAttendees: 20, registeredCount: 19 },
  { id: "e2", venueId: "v1", type: "networking",  title: "Meetup",       startMs: NOW + 7200_000, endMs: NOW + 10800_000, maxAttendees: 50, registeredCount: 10 },
  { id: "e3", venueId: "v1", type: "webinar",     title: "Product Demo", startMs: NOW - 3600_000, endMs: NOW - 1000, maxAttendees: 100, registeredCount: 45 }, // past
  { id: "e4", venueId: "v2", type: "coworking_day", title: "Open Day",   startMs: NOW + 100,    endMs: NOW + 28800_000, maxAttendees: 5, registeredCount: 5  },
];

describe("Venue event calendar", () => {
  it("isFull: e1 has 19/20 → not full", () => {
    expect(isFull(EVENTS[0])).toBe(false);
  });

  it("isFull: e4 has 5/5 → full", () => {
    expect(isFull(EVENTS[3])).toBe(true);
  });

  it("spotsRemaining: e1 = 1 spot", () => {
    expect(spotsRemaining(EVENTS[0])).toBe(1);
  });

  it("spotsRemaining: e2 = 40 spots", () => {
    expect(spotsRemaining(EVENTS[1])).toBe(40);
  });

  it("upcomingEvents: v1 has 2 future events sorted", () => {
    const upcoming = upcomingEvents(EVENTS, "v1", NOW);
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].id).toBe("e1");
  });

  it("upcomingEvents: v2 has 1 future event", () => {
    expect(upcomingEvents(EVENTS, "v2", NOW)).toHaveLength(1);
  });

  it("register: increments registeredCount", () => {
    const updated = register(EVENTS[0]);
    expect(updated.registeredCount).toBe(20);
  });

  it("register: throws when full", () => {
    expect(() => register(EVENTS[3])).toThrow("Event is full");
  });

  it("register is immutable", () => {
    register(EVENTS[0]);
    expect(EVENTS[0].registeredCount).toBe(19);
  });
});
