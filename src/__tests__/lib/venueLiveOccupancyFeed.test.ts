/**
 * Tests for venue live occupancy feed processing.
 */

interface OccupancyEvent {
  eventId: string;
  venueId: string;
  zoneId: string;
  eventType: "entry" | "exit" | "reset";
  timestamp: number;
  count: number; // for reset events
}

interface OccupancyState {
  venueId: string;
  zoneId: string;
  currentCount: number;
  lastUpdated: number;
  capacity: number;
}

function applyOccupancyEvent(state: OccupancyState, event: OccupancyEvent): OccupancyState {
  if (event.venueId !== state.venueId || event.zoneId !== state.zoneId) return state;
  let newCount = state.currentCount;
  if (event.eventType === "entry") newCount = Math.min(state.capacity, state.currentCount + 1);
  else if (event.eventType === "exit") newCount = Math.max(0, state.currentCount - 1);
  else if (event.eventType === "reset") newCount = Math.min(event.count, state.capacity);
  return { ...state, currentCount: newCount, lastUpdated: event.timestamp };
}

function occupancyPercent(state: OccupancyState): number {
  if (state.capacity === 0) return 0;
  return Math.round((state.currentCount / state.capacity) * 100);
}

function processEventBatch(
  states: OccupancyState[],
  events: OccupancyEvent[]
): OccupancyState[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let current = [...states];
  for (const event of sorted) {
    current = current.map((s) => applyOccupancyEvent(s, event));
  }
  return current;
}

const NOW = 1_700_000_000_000;
const STATE: OccupancyState = { venueId: "v1", zoneId: "main", currentCount: 10, lastUpdated: NOW - 1000, capacity: 20 };

describe("Venue live occupancy feed", () => {
  it("applyOccupancyEvent: entry increments", () => {
    const event: OccupancyEvent = { eventId: "e1", venueId: "v1", zoneId: "main", eventType: "entry", timestamp: NOW, count: 0 };
    expect(applyOccupancyEvent(STATE, event).currentCount).toBe(11);
  });

  it("applyOccupancyEvent: exit decrements", () => {
    const event: OccupancyEvent = { eventId: "e2", venueId: "v1", zoneId: "main", eventType: "exit", timestamp: NOW, count: 0 };
    expect(applyOccupancyEvent(STATE, event).currentCount).toBe(9);
  });

  it("applyOccupancyEvent: reset sets count", () => {
    const event: OccupancyEvent = { eventId: "e3", venueId: "v1", zoneId: "main", eventType: "reset", timestamp: NOW, count: 5 };
    expect(applyOccupancyEvent(STATE, event).currentCount).toBe(5);
  });

  it("applyOccupancyEvent: entry cannot exceed capacity", () => {
    const full = { ...STATE, currentCount: 20 };
    const event: OccupancyEvent = { eventId: "e4", venueId: "v1", zoneId: "main", eventType: "entry", timestamp: NOW, count: 0 };
    expect(applyOccupancyEvent(full, event).currentCount).toBe(20);
  });

  it("applyOccupancyEvent: exit cannot go below 0", () => {
    const empty = { ...STATE, currentCount: 0 };
    const event: OccupancyEvent = { eventId: "e5", venueId: "v1", zoneId: "main", eventType: "exit", timestamp: NOW, count: 0 };
    expect(applyOccupancyEvent(empty, event).currentCount).toBe(0);
  });

  it("applyOccupancyEvent: wrong venue → no change", () => {
    const event: OccupancyEvent = { eventId: "e6", venueId: "v2", zoneId: "main", eventType: "entry", timestamp: NOW, count: 0 };
    expect(applyOccupancyEvent(STATE, event).currentCount).toBe(10);
  });

  it("occupancyPercent: 10/20 = 50%", () => {
    expect(occupancyPercent(STATE)).toBe(50);
  });
});
