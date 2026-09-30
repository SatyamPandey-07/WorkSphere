/**
 * Tests for venue operating hours overlap with user availability.
 */

interface TimeRange {
  startMinutes: number; // minutes since midnight
  endMinutes: number;
}

interface OperatingDay {
  dayOfWeek: number; // 0=Sun, 6=Sat
  hours: TimeRange[];
}

function hasOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

function overlapMinutes(a: TimeRange, b: TimeRange): number {
  const start = Math.max(a.startMinutes, b.startMinutes);
  const end = Math.min(a.endMinutes, b.endMinutes);
  return Math.max(0, end - start);
}

function venueOpenAtTime(
  days: OperatingDay[],
  dayOfWeek: number,
  minute: number
): boolean {
  const day = days.find((d) => d.dayOfWeek === dayOfWeek);
  if (!day) return false;
  return day.hours.some((h) => minute >= h.startMinutes && minute < h.endMinutes);
}

function longestAvailableBlock(
  venueHours: TimeRange,
  userAvailability: TimeRange[]
): number {
  return Math.max(
    0,
    ...userAvailability.map((ua) => overlapMinutes(venueHours, ua))
  );
}

const VENUE_DAY: OperatingDay[] = [
  { dayOfWeek: 1, hours: [{ startMinutes: 480, endMinutes: 1200 }] }, // Mon 8am-8pm
  { dayOfWeek: 2, hours: [{ startMinutes: 480, endMinutes: 1200 }] }, // Tue 8am-8pm
];

describe("Venue operating hours overlap", () => {
  it("hasOverlap: overlapping ranges → true", () => {
    expect(hasOverlap({ startMinutes: 480, endMinutes: 720 }, { startMinutes: 600, endMinutes: 840 })).toBe(true);
  });

  it("hasOverlap: adjacent → false", () => {
    expect(hasOverlap({ startMinutes: 480, endMinutes: 600 }, { startMinutes: 600, endMinutes: 720 })).toBe(false);
  });

  it("overlapMinutes: 2h overlap", () => {
    expect(overlapMinutes({ startMinutes: 480, endMinutes: 720 }, { startMinutes: 600, endMinutes: 840 })).toBe(120);
  });

  it("overlapMinutes: no overlap → 0", () => {
    expect(overlapMinutes({ startMinutes: 480, endMinutes: 600 }, { startMinutes: 700, endMinutes: 800 })).toBe(0);
  });

  it("venueOpenAtTime: Mon 9am = 540 → true", () => {
    expect(venueOpenAtTime(VENUE_DAY, 1, 540)).toBe(true);
  });

  it("venueOpenAtTime: Mon 8pm = 1200 → false (exclusive end)", () => {
    expect(venueOpenAtTime(VENUE_DAY, 1, 1200)).toBe(false);
  });

  it("venueOpenAtTime: Saturday → false (no entry)", () => {
    expect(venueOpenAtTime(VENUE_DAY, 6, 540)).toBe(false);
  });

  it("longestAvailableBlock: best overlap slot", () => {
    const venueHours: TimeRange = { startMinutes: 480, endMinutes: 1200 };
    const userSlots: TimeRange[] = [
      { startMinutes: 600, endMinutes: 720 }, // 120 min overlap
      { startMinutes: 900, endMinutes: 1080 }, // 180 min overlap
    ];
    expect(longestAvailableBlock(venueHours, userSlots)).toBe(180);
  });
});
