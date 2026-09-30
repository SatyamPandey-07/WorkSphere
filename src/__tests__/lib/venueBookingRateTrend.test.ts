/**
 * Tests for venue booking rate trend calculation (week-over-week).
 */

interface WeeklyBookings {
  weekStart: string; // YYYY-MM-DD (Monday)
  bookingCount: number;
  revenueCents: number;
}

function weekOverWeekGrowth(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function trendDirection(growthPct: number): "up" | "down" | "flat" {
  if (growthPct > 5)  return "up";
  if (growthPct < -5) return "down";
  return "flat";
}

function calculateTrend(weeks: WeeklyBookings[]): {
  bookingGrowthPct: number;
  revenueGrowthPct: number;
  direction: "up" | "down" | "flat";
} {
  if (weeks.length < 2) return { bookingGrowthPct: 0, revenueGrowthPct: 0, direction: "flat" };
  const [prev, curr] = weeks.slice(-2);
  const bookingGrowthPct = weekOverWeekGrowth(curr.bookingCount, prev.bookingCount);
  const revenueGrowthPct = weekOverWeekGrowth(curr.revenueCents, prev.revenueCents);
  return { bookingGrowthPct, revenueGrowthPct, direction: trendDirection(bookingGrowthPct) };
}

const WEEKS: WeeklyBookings[] = [
  { weekStart: "2026-09-14", bookingCount: 20, revenueCents: 100_000 },
  { weekStart: "2026-09-21", bookingCount: 25, revenueCents: 125_000 },
  { weekStart: "2026-09-28", bookingCount: 30, revenueCents: 150_000 },
];

describe("Venue booking rate trend", () => {
  it("weekOverWeekGrowth: 25 from 20 = 25%", () => {
    expect(weekOverWeekGrowth(25, 20)).toBe(25);
  });

  it("weekOverWeekGrowth: 0 from 0 = 0", () => {
    expect(weekOverWeekGrowth(0, 0)).toBe(0);
  });

  it("weekOverWeekGrowth: from 0 with positives = 100%", () => {
    expect(weekOverWeekGrowth(5, 0)).toBe(100);
  });

  it("weekOverWeekGrowth: decline", () => {
    expect(weekOverWeekGrowth(15, 20)).toBe(-25);
  });

  it("trendDirection: 25% → up", () => {
    expect(trendDirection(25)).toBe("up");
  });

  it("trendDirection: -10% → down", () => {
    expect(trendDirection(-10)).toBe("down");
  });

  it("trendDirection: 3% → flat", () => {
    expect(trendDirection(3)).toBe("flat");
  });

  it("calculateTrend: 25 → 30 = 20% growth upward", () => {
    const trend = calculateTrend(WEEKS);
    expect(trend.bookingGrowthPct).toBe(20);
    expect(trend.direction).toBe("up");
  });

  it("calculateTrend: fewer than 2 weeks → flat", () => {
    expect(calculateTrend([WEEKS[0]]).direction).toBe("flat");
  });
});
