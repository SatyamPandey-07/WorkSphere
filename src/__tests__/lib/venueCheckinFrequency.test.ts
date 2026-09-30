/**
 * Tests for venue check-in frequency analysis.
 */

interface CheckinRecord {
  userId: string;
  venueId: string;
  checkinAt: number;
}

function checkinsPerDay(
  records: CheckinRecord[],
  venueId: string,
  date: string
): number {
  const start = new Date(date).getTime();
  const end = start + 86_400_000;
  return records.filter(
    (r) => r.venueId === venueId && r.checkinAt >= start && r.checkinAt < end
  ).length;
}

function averageCheckinsPerDay(
  records: CheckinRecord[],
  venueId: string,
  days: number,
  endMs: number
): number {
  if (days === 0) return 0;
  const startMs = endMs - days * 86_400_000;
  const relevant = records.filter(
    (r) => r.venueId === venueId && r.checkinAt >= startMs && r.checkinAt < endMs
  );
  return relevant.length / days;
}

function uniqueVisitors(
  records: CheckinRecord[],
  venueId: string,
  windowMs: number,
  nowMs: number
): number {
  return new Set(
    records
      .filter(
        (r) =>
          r.venueId === venueId &&
          nowMs - r.checkinAt <= windowMs
      )
      .map((r) => r.userId)
  ).size;
}

const NOW = 1_700_000_000_000;
const RECORDS: CheckinRecord[] = [
  { userId: "u1", venueId: "v1", checkinAt: NOW - 3 * 86_400_000 + 1000 }, // day -3
  { userId: "u2", venueId: "v1", checkinAt: NOW - 2 * 86_400_000 + 1000 }, // day -2
  { userId: "u1", venueId: "v1", checkinAt: NOW - 2 * 86_400_000 + 2000 }, // day -2
  { userId: "u3", venueId: "v1", checkinAt: NOW - 1 * 86_400_000 + 1000 }, // day -1
  { userId: "u4", venueId: "v2", checkinAt: NOW - 1 * 86_400_000 + 1000 }, // different venue
];

describe("Venue check-in frequency", () => {
  const DAY_MINUS_2 = new Date(NOW - 2 * 86_400_000).toISOString().split("T")[0];

  it("checkinsPerDay: day -2 has 2 check-ins", () => {
    expect(checkinsPerDay(RECORDS, "v1", DAY_MINUS_2)).toBe(2);
  });

  it("checkinsPerDay: v2 has 0 on that day", () => {
    expect(checkinsPerDay(RECORDS, "v2", DAY_MINUS_2)).toBe(0);
  });

  it("averageCheckinsPerDay: v1 over 3 days = 4/3", () => {
    expect(averageCheckinsPerDay(RECORDS, "v1", 3, NOW)).toBeCloseTo(4 / 3);
  });

  it("averageCheckinsPerDay: 0 days → 0", () => {
    expect(averageCheckinsPerDay(RECORDS, "v1", 0, NOW)).toBe(0);
  });

  it("uniqueVisitors: 3 unique users in last 3 days for v1", () => {
    expect(uniqueVisitors(RECORDS, "v1", 3 * 86_400_000, NOW)).toBe(3);
  });

  it("uniqueVisitors: v2 has 1 unique visitor", () => {
    expect(uniqueVisitors(RECORDS, "v2", 3 * 86_400_000, NOW)).toBe(1);
  });
});
