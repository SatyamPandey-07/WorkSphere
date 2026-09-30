/**
 * Tests for venue booking report generation utilities.
 */

interface ReportPeriod {
  startMs: number;
  endMs: number;
  label: string;
}

interface BookingDataPoint {
  date: string;     // YYYY-MM-DD
  venueId: string;
  bookings: number;
  revenue: number;
  cancellations: number;
  avgGuestCount: number;
}

function periodDays(period: ReportPeriod): number {
  return Math.round((period.endMs - period.startMs) / 86_400_000);
}

function totalRevenue(data: BookingDataPoint[]): number {
  return Math.round(data.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
}

function totalBookings(data: BookingDataPoint[]): number {
  return data.reduce((s, d) => s + d.bookings, 0);
}

function cancellationRate(data: BookingDataPoint[]): number {
  const bookings = totalBookings(data);
  if (bookings === 0) return 0;
  const cancellations = data.reduce((s, d) => s + d.cancellations, 0);
  return Math.round((cancellations / bookings) * 100);
}

function revenuePerBooking(data: BookingDataPoint[]): number {
  const bookings = totalBookings(data);
  if (bookings === 0) return 0;
  return Math.round((totalRevenue(data) / bookings) * 100) / 100;
}

function topVenueByRevenue(data: BookingDataPoint[]): string | null {
  if (data.length === 0) return null;
  const byVenue: Record<string, number> = {};
  for (const d of data) byVenue[d.venueId] = (byVenue[d.venueId] ?? 0) + d.revenue;
  return Object.entries(byVenue).sort((a, b) => b[1] - a[1])[0][0];
}

function growthRate(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

const NOW = 1_700_000_000_000;
const PERIOD: ReportPeriod = { startMs: NOW - 30 * 86_400_000, endMs: NOW, label: "Last 30 days" };
const DATA: BookingDataPoint[] = [
  { date: "2026-09-01", venueId: "v1", bookings: 20, revenue: 5000, cancellations: 2, avgGuestCount: 30 },
  { date: "2026-09-08", venueId: "v2", bookings: 15, revenue: 8000, cancellations: 1, avgGuestCount: 80 },
  { date: "2026-09-15", venueId: "v1", bookings: 25, revenue: 6000, cancellations: 3, avgGuestCount: 35 },
];

describe("Report generator utilities", () => {
  it("periodDays: 30-day period = 30", () => {
    expect(periodDays(PERIOD)).toBe(30);
  });

  it("totalRevenue: $19000", () => {
    expect(totalRevenue(DATA)).toBe(19000);
  });

  it("totalBookings: 60", () => {
    expect(totalBookings(DATA)).toBe(60);
  });

  it("cancellationRate: 6 of 60 = 10%", () => {
    expect(cancellationRate(DATA)).toBe(10);
  });

  it("revenuePerBooking: $19000 / 60 ≈ $316.67", () => {
    expect(revenuePerBooking(DATA)).toBeGreaterThan(316);
  });

  it("topVenueByRevenue: v1 has $11000 (more than v2 $8000)", () => {
    expect(topVenueByRevenue(DATA)).toBe("v1");
  });

  it("growthRate: 120 vs 100 = 20%", () => {
    expect(growthRate(120, 100)).toBe(20);
  });
});
