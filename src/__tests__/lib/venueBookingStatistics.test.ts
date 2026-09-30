/**
 * Tests for comprehensive venue booking statistics.
 */

interface BookingStat {
  venueId: string;
  date: string;
  hour: number;
  bookingCount: number;
  totalRevenueCents: number;
  avgDurationMinutes: number;
  newCustomers: number;
  returningCustomers: number;
}

function customerRetentionRate(stats: BookingStat[], venueId: string): number {
  const venue = stats.filter((s) => s.venueId === venueId);
  const totalCustomers = venue.reduce((s, b) => s + b.newCustomers + b.returningCustomers, 0);
  const returning = venue.reduce((s, b) => s + b.returningCustomers, 0);
  if (totalCustomers === 0) return 0;
  return Math.round((returning / totalCustomers) * 100);
}

function revenuePerBooking(stats: BookingStat[], venueId: string): number {
  const venue = stats.filter((s) => s.venueId === venueId);
  const totalBookings = venue.reduce((s, b) => s + b.bookingCount, 0);
  const totalRevenue = venue.reduce((s, b) => s + b.totalRevenueCents, 0);
  if (totalBookings === 0) return 0;
  return Math.round(totalRevenue / totalBookings);
}

function busiestHour(stats: BookingStat[], venueId: string): number | null {
  const venue = stats.filter((s) => s.venueId === venueId);
  if (venue.length === 0) return null;
  const hourTotals: Record<number, number> = {};
  venue.forEach((s) => { hourTotals[s.hour] = (hourTotals[s.hour] ?? 0) + s.bookingCount; });
  return Number(Object.entries(hourTotals).sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]);
}

function dailyRevenueAverage(stats: BookingStat[], venueId: string): number {
  const uniqueDates = new Set(stats.filter((s) => s.venueId === venueId).map((s) => s.date));
  if (uniqueDates.size === 0) return 0;
  const totalRevenue = stats.filter((s) => s.venueId === venueId).reduce((s, b) => s + b.totalRevenueCents, 0);
  return Math.round(totalRevenue / uniqueDates.size);
}

const STATS: BookingStat[] = [
  { venueId: "v1", date: "2026-10-01", hour: 9,  bookingCount: 5, totalRevenueCents: 25_000, avgDurationMinutes: 120, newCustomers: 3, returningCustomers: 2 },
  { venueId: "v1", date: "2026-10-01", hour: 14, bookingCount: 8, totalRevenueCents: 40_000, avgDurationMinutes: 90,  newCustomers: 2, returningCustomers: 6 },
  { venueId: "v1", date: "2026-10-02", hour: 9,  bookingCount: 4, totalRevenueCents: 20_000, avgDurationMinutes: 60,  newCustomers: 4, returningCustomers: 0 },
  { venueId: "v2", date: "2026-10-01", hour: 10, bookingCount: 3, totalRevenueCents: 15_000, avgDurationMinutes: 120, newCustomers: 1, returningCustomers: 2 },
];

describe("Venue booking statistics", () => {
  it("customerRetentionRate: v1 = 8/(5+8+4) returning/(total) customers", () => {
    // total = (3+2) + (2+6) + (4+0) = 17; returning = 2+6+0 = 8
    expect(customerRetentionRate(STATS, "v1")).toBe(47); // 8/17 ≈ 47%
  });

  it("revenuePerBooking: v1 = (25000+40000+20000)/17 ≈ 5000", () => {
    expect(revenuePerBooking(STATS, "v1")).toBeCloseTo(5000, -2);
  });

  it("busiestHour: v1 peak = 14 (8 bookings vs 9 at 9am total 9)", () => {
    // hour 9: 5+4=9, hour 14: 8=8 → hour 9 is busiest
    expect(busiestHour(STATS, "v1")).toBe(9);
  });

  it("busiestHour: unknown venue → null", () => {
    expect(busiestHour(STATS, "v99")).toBeNull();
  });

  it("dailyRevenueAverage: v1 = (85000)/2 = 42500", () => {
    expect(dailyRevenueAverage(STATS, "v1")).toBe(42_500);
  });
});
