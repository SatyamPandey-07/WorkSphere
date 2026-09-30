/**
 * Tests for user venue visit history tracking.
 */

interface VenueVisit {
  userId: string;
  venueId: string;
  visitedAt: number;
  durationMinutes: number;
}

function totalVisits(history: VenueVisit[], userId: string): number {
  return history.filter((v) => v.userId === userId).length;
}

function totalMinutesAtVenue(
  history: VenueVisit[],
  userId: string,
  venueId: string
): number {
  return history
    .filter((v) => v.userId === userId && v.venueId === venueId)
    .reduce((sum, v) => sum + v.durationMinutes, 0);
}

function mostVisitedVenue(
  history: VenueVisit[],
  userId: string
): string | null {
  const counts: Record<string, number> = {};
  history
    .filter((v) => v.userId === userId)
    .forEach((v) => { counts[v.venueId] = (counts[v.venueId] ?? 0) + 1; });
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.reduce((top, curr) => curr[1] > top[1] ? curr : top)[0];
}

function uniqueVenues(history: VenueVisit[], userId: string): string[] {
  return [...new Set(history.filter((v) => v.userId === userId).map((v) => v.venueId))];
}

const NOW = 1_700_000_000_000;
const HISTORY: VenueVisit[] = [
  { userId: "u1", venueId: "v1", visitedAt: NOW - 7200_000, durationMinutes: 120 },
  { userId: "u1", venueId: "v2", visitedAt: NOW - 3600_000, durationMinutes: 60  },
  { userId: "u1", venueId: "v1", visitedAt: NOW - 1800_000, durationMinutes: 90  },
  { userId: "u2", venueId: "v3", visitedAt: NOW - 600_000,  durationMinutes: 30  },
];

describe("Venue visit history", () => {
  it("totalVisits: u1 has 3 visits", () => {
    expect(totalVisits(HISTORY, "u1")).toBe(3);
  });

  it("totalVisits: u2 has 1 visit", () => {
    expect(totalVisits(HISTORY, "u2")).toBe(1);
  });

  it("totalMinutesAtVenue: u1 at v1 = 210 min", () => {
    expect(totalMinutesAtVenue(HISTORY, "u1", "v1")).toBe(210);
  });

  it("totalMinutesAtVenue: u1 at v2 = 60 min", () => {
    expect(totalMinutesAtVenue(HISTORY, "u1", "v2")).toBe(60);
  });

  it("totalMinutesAtVenue: no visits → 0", () => {
    expect(totalMinutesAtVenue(HISTORY, "u99", "v1")).toBe(0);
  });

  it("mostVisitedVenue: u1 → v1 (2 visits)", () => {
    expect(mostVisitedVenue(HISTORY, "u1")).toBe("v1");
  });

  it("mostVisitedVenue: no history → null", () => {
    expect(mostVisitedVenue(HISTORY, "u99")).toBeNull();
  });

  it("uniqueVenues: u1 visited 2 unique venues", () => {
    expect(uniqueVenues(HISTORY, "u1")).toHaveLength(2);
  });
});
