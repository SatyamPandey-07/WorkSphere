/**
 * Tests for venue space utilization weekly/monthly report generation.
 */

interface DailyUtilization {
  date: string;
  venueId: string;
  bookings: number;
  totalHours: number;
  revenueCents: number;
  peakOccupancyPct: number;
}

function weeklyReport(
  data: DailyUtilization[],
  venueId: string,
  weekStart: string,
  weekEnd: string
): {
  totalBookings: number;
  totalHours: number;
  totalRevenueCents: number;
  avgPeakOccupancy: number;
  highestRevenueDay: string | null;
} {
  const week = data.filter(
    (d) => d.venueId === venueId && d.date >= weekStart && d.date <= weekEnd
  );

  if (week.length === 0) {
    return { totalBookings: 0, totalHours: 0, totalRevenueCents: 0, avgPeakOccupancy: 0, highestRevenueDay: null };
  }

  const highestDay = week.reduce((max, d) => d.revenueCents > max.revenueCents ? d : max);

  return {
    totalBookings: week.reduce((s, d) => s + d.bookings, 0),
    totalHours: week.reduce((s, d) => s + d.totalHours, 0),
    totalRevenueCents: week.reduce((s, d) => s + d.revenueCents, 0),
    avgPeakOccupancy: Math.round(week.reduce((s, d) => s + d.peakOccupancyPct, 0) / week.length),
    highestRevenueDay: highestDay.date,
  };
}

function yoyGrowth(currentCents: number, previousCents: number): number {
  if (previousCents === 0) return 100;
  return Math.round(((currentCents - previousCents) / previousCents) * 100);
}

const DATA: DailyUtilization[] = [
  { date: "2026-10-01", venueId: "v1", bookings: 5,  totalHours: 20, revenueCents: 10_000, peakOccupancyPct: 60 },
  { date: "2026-10-02", venueId: "v1", bookings: 8,  totalHours: 32, revenueCents: 16_000, peakOccupancyPct: 80 },
  { date: "2026-10-03", venueId: "v1", bookings: 3,  totalHours: 12, revenueCents: 6_000,  peakOccupancyPct: 40 },
  { date: "2026-10-07", venueId: "v1", bookings: 10, totalHours: 40, revenueCents: 20_000, peakOccupancyPct: 90 }, // different week
];

describe("Venue space utilization report", () => {
  it("weeklyReport: Oct 1-3 totals", () => {
    const report = weeklyReport(DATA, "v1", "2026-10-01", "2026-10-03");
    expect(report.totalBookings).toBe(16);
    expect(report.totalRevenueCents).toBe(32_000);
  });

  it("weeklyReport: highest revenue day = Oct 2", () => {
    const report = weeklyReport(DATA, "v1", "2026-10-01", "2026-10-03");
    expect(report.highestRevenueDay).toBe("2026-10-02");
  });

  it("weeklyReport: avg peak occupancy = 60%", () => {
    const report = weeklyReport(DATA, "v1", "2026-10-01", "2026-10-03");
    expect(report.avgPeakOccupancy).toBe(60);
  });

  it("weeklyReport: empty period → zeros", () => {
    const report = weeklyReport(DATA, "v1", "2026-10-10", "2026-10-16");
    expect(report.totalBookings).toBe(0);
    expect(report.highestRevenueDay).toBeNull();
  });

  it("yoyGrowth: 20% growth", () => {
    expect(yoyGrowth(12_000, 10_000)).toBe(20);
  });

  it("yoyGrowth: decline", () => {
    expect(yoyGrowth(8_000, 10_000)).toBe(-20);
  });

  it("yoyGrowth: from 0 → 100%", () => {
    expect(yoyGrowth(1000, 0)).toBe(100);
  });
});
