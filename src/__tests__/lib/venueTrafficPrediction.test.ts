/**
 * Tests for venue traffic prediction based on external events.
 */

interface ExternalEvent {
  eventId: string;
  name: string;
  distanceKm: number;
  expectedAttendees: number;
  startMs: number;
  endMs: number;
  type: "conference" | "concert" | "sports" | "festival";
}

interface TrafficImpact {
  event: ExternalEvent;
  impactScore: number;  // 0-100 (100 = very high impact)
  expectedExtraVisitors: number;
}

function calculateEventImpact(event: ExternalEvent): number {
  const distanceFactor = Math.max(0, 1 - event.distanceKm / 10); // decreases with distance
  const sizeFactor = Math.min(1, event.expectedAttendees / 10_000);
  const typeMultiplier = { conference: 0.8, concert: 0.5, sports: 0.6, festival: 0.7 }[event.type];
  return Math.round(distanceFactor * sizeFactor * typeMultiplier * 100);
}

function predictExtraVisitors(
  event: ExternalEvent,
  venueCapacity: number
): number {
  const impact = calculateEventImpact(event);
  return Math.round(venueCapacity * (impact / 100) * 0.15); // ~15% of capacity per impact point
}

function upcomingImpactfulEvents(
  events: ExternalEvent[],
  nowMs: number,
  windowMs: number,
  minImpact = 20
): TrafficImpact[] {
  return events
    .filter((e) => e.startMs >= nowMs && e.startMs <= nowMs + windowMs)
    .map((e) => ({
      event: e,
      impactScore: calculateEventImpact(e),
      expectedExtraVisitors: predictExtraVisitors(e, 50),
    }))
    .filter((ti) => ti.impactScore >= minImpact)
    .sort((a, b) => b.impactScore - a.impactScore);
}

const NOW = 1_700_000_000_000;
const EVENTS: ExternalEvent[] = [
  { eventId: "e1", name: "Tech Conference", distanceKm: 0.5, expectedAttendees: 5000,  startMs: NOW + 86_400_000, endMs: NOW + 3 * 86_400_000, type: "conference" },
  { eventId: "e2", name: "Rock Concert",    distanceKm: 2.0, expectedAttendees: 20000, startMs: NOW + 2 * 86_400_000, endMs: NOW + 2.5 * 86_400_000, type: "concert" },
  { eventId: "e3", name: "Football Game",   distanceKm: 8.0, expectedAttendees: 50000, startMs: NOW + 86_400_000, endMs: NOW + 1.5 * 86_400_000, type: "sports" },
];

describe("Venue traffic prediction", () => {
  it("calculateEventImpact: close conference with 5000 attendees", () => {
    const impact = calculateEventImpact(EVENTS[0]);
    expect(impact).toBeGreaterThan(20);
  });

  it("calculateEventImpact: distant event has lower impact", () => {
    const close = calculateEventImpact(EVENTS[0]);
    const far = calculateEventImpact(EVENTS[2]);
    expect(close).toBeGreaterThan(far);
  });

  it("predictExtraVisitors: returns positive count for impactful event", () => {
    expect(predictExtraVisitors(EVENTS[0], 50)).toBeGreaterThan(0);
  });

  it("upcomingImpactfulEvents: events in next 7 days above threshold", () => {
    const impacts = upcomingImpactfulEvents(EVENTS, NOW, 7 * 86_400_000);
    expect(impacts.length).toBeGreaterThan(0);
  });

  it("upcomingImpactfulEvents: sorted by impact score descending", () => {
    const impacts = upcomingImpactfulEvents(EVENTS, NOW, 7 * 86_400_000, 0);
    if (impacts.length > 1) {
      expect(impacts[0].impactScore).toBeGreaterThanOrEqual(impacts[1].impactScore);
    }
  });

  it("upcomingImpactfulEvents: excludes past events", () => {
    const past = [{ ...EVENTS[0], startMs: NOW - 86_400_000 }];
    expect(upcomingImpactfulEvents(past, NOW, 7 * 86_400_000, 0)).toHaveLength(0);
  });
});
