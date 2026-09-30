/**
 * Tests for venue booking blackout period enforcement.
 */

interface BlackoutPeriod {
  blackoutId: string;
  venueId: string;
  startDate: string;
  endDate: string;
  reason: string;
  affectedSpaces: string[] | null; // null = all spaces
}

function isDateBlackedOut(
  blackouts: BlackoutPeriod[],
  venueId: string,
  date: string,
  spaceId?: string
): boolean {
  return blackouts.some((b) => {
    if (b.venueId !== venueId) return false;
    if (date < b.startDate || date > b.endDate) return false;
    if (b.affectedSpaces !== null && spaceId && !b.affectedSpaces.includes(spaceId)) return false;
    return true;
  });
}

function blackoutDayCount(blackout: BlackoutPeriod): number {
  const start = new Date(blackout.startDate);
  const end = new Date(blackout.endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function getBlackoutReason(
  blackouts: BlackoutPeriod[],
  venueId: string,
  date: string
): string | null {
  const blackout = blackouts.find(
    (b) => b.venueId === venueId && date >= b.startDate && date <= b.endDate
  );
  return blackout ? blackout.reason : null;
}

function upcomingBlackouts(
  blackouts: BlackoutPeriod[],
  venueId: string,
  todayStr: string,
  limit = 5
): BlackoutPeriod[] {
  return blackouts
    .filter((b) => b.venueId === venueId && b.endDate >= todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit);
}

const BLACKOUTS: BlackoutPeriod[] = [
  { blackoutId: "bo1", venueId: "v1", startDate: "2026-12-24", endDate: "2026-12-26", reason: "Christmas holiday", affectedSpaces: null },
  { blackoutId: "bo2", venueId: "v1", startDate: "2026-11-01", endDate: "2026-11-03", reason: "Renovation", affectedSpaces: ["sp1", "sp2"] },
  { blackoutId: "bo3", venueId: "v2", startDate: "2026-12-31", endDate: "2027-01-01", reason: "New Year", affectedSpaces: null },
];

describe("Venue booking blackout period enforcement", () => {
  it("isDateBlackedOut: Christmas blackout covers Dec 25", () => {
    expect(isDateBlackedOut(BLACKOUTS, "v1", "2026-12-25")).toBe(true);
  });

  it("isDateBlackedOut: before blackout → false", () => {
    expect(isDateBlackedOut(BLACKOUTS, "v1", "2026-12-23")).toBe(false);
  });

  it("isDateBlackedOut: renovation affects sp1 → true", () => {
    expect(isDateBlackedOut(BLACKOUTS, "v1", "2026-11-02", "sp1")).toBe(true);
  });

  it("isDateBlackedOut: renovation does not affect sp3 → false", () => {
    expect(isDateBlackedOut(BLACKOUTS, "v1", "2026-11-02", "sp3")).toBe(false);
  });

  it("blackoutDayCount: Christmas = 3 days", () => {
    expect(blackoutDayCount(BLACKOUTS[0])).toBe(3);
  });

  it("getBlackoutReason: returns reason for blacked out date", () => {
    expect(getBlackoutReason(BLACKOUTS, "v1", "2026-12-25")).toBe("Christmas holiday");
  });

  it("getBlackoutReason: no blackout → null", () => {
    expect(getBlackoutReason(BLACKOUTS, "v1", "2026-10-01")).toBeNull();
  });

  it("upcomingBlackouts: sorted by start date", () => {
    const upcoming = upcomingBlackouts(BLACKOUTS, "v1", "2026-10-01");
    expect(upcoming[0].startDate).toBe("2026-11-01");
  });
});
