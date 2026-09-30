/**
 * Tests for real-time venue occupancy tracker.
 */

interface OccupancyEvent {
  eventId: string;
  venueId: string;
  zoneId: string;
  type: "entry" | "exit" | "manual_update";
  count: number;      // +ve for entry, -ve for exit, absolute for manual_update
  timestamp: number;
  source: "badge_reader" | "camera" | "manual" | "booking_system";
}

interface ZoneOccupancy {
  venueId: string;
  zoneId: string;
  currentCount: number;
  maxCapacity: number;
  lastEventAt: number;
  events: OccupancyEvent[];
}

function applyOccupancyEvent(zone: ZoneOccupancy, event: OccupancyEvent): ZoneOccupancy {
  if (event.venueId !== zone.venueId || event.zoneId !== zone.zoneId) return zone;

  let newCount: number;
  if (event.type === "manual_update") {
    newCount = Math.min(event.count, zone.maxCapacity);
  } else {
    newCount = zone.currentCount + event.count;
  }

  return {
    ...zone,
    currentCount: Math.max(0, Math.min(newCount, zone.maxCapacity)),
    lastEventAt: event.timestamp,
    events: [...zone.events, event],
  };
}

function occupancyRate(zone: ZoneOccupancy): number {
  if (zone.maxCapacity === 0) return 0;
  return Math.round((zone.currentCount / zone.maxCapacity) * 100);
}

function alertLevel(zone: ZoneOccupancy): "green" | "yellow" | "red" | "full" {
  const rate = occupancyRate(zone);
  if (rate >= 100) return "full";
  if (rate >= 80) return "red";
  if (rate >= 60) return "yellow";
  return "green";
}

function hourlyOccupancyAvg(events: OccupancyEvent[], hour: number): number {
  const hourMs = hour * 3_600_000;
  const dayMs = 86_400_000;
  const hourEvents = events.filter((e) => e.timestamp % dayMs >= hourMs && e.timestamp % dayMs < hourMs + 3_600_000);
  if (hourEvents.length === 0) return 0;
  return Math.round(hourEvents.reduce((s, e) => s + Math.abs(e.count), 0) / hourEvents.length);
}

const NOW = 1_700_000_000_000;
const ZONE: ZoneOccupancy = {
  venueId: "v1", zoneId: "main",
  currentCount: 15, maxCapacity: 25,
  lastEventAt: NOW - 1000, events: [],
};

describe("Venue occupancy tracker", () => {
  it("applyOccupancyEvent: entry adds count", () => {
    const event: OccupancyEvent = { eventId: "e1", venueId: "v1", zoneId: "main", type: "entry", count: 3, timestamp: NOW, source: "badge_reader" };
    const updated = applyOccupancyEvent(ZONE, event);
    expect(updated.currentCount).toBe(18);
  });

  it("applyOccupancyEvent: exit reduces count", () => {
    const event: OccupancyEvent = { eventId: "e2", venueId: "v1", zoneId: "main", type: "exit", count: -5, timestamp: NOW, source: "camera" };
    const updated = applyOccupancyEvent(ZONE, event);
    expect(updated.currentCount).toBe(10);
  });

  it("applyOccupancyEvent: clamps at max capacity", () => {
    const event: OccupancyEvent = { eventId: "e3", venueId: "v1", zoneId: "main", type: "entry", count: 20, timestamp: NOW, source: "manual" };
    const updated = applyOccupancyEvent(ZONE, event);
    expect(updated.currentCount).toBe(25);
  });

  it("occupancyRate: 15/25 = 60%", () => {
    expect(occupancyRate(ZONE)).toBe(60);
  });

  it("alertLevel: 60% → yellow", () => {
    expect(alertLevel(ZONE)).toBe("yellow");
  });

  it("alertLevel: full → full", () => {
    const full = { ...ZONE, currentCount: 25 };
    expect(alertLevel(full)).toBe("full");
  });
});
