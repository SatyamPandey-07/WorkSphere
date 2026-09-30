/**
 * Tests for venue analytics summary generation.
 */

interface BookingAnalytics {
  date: string; // YYYY-MM-DD
  bookingCount: number;
  revenueCents: number;
  avgDurationMinutes: number;
  occupancyPct: number;
}

function totalRevenue(data: BookingAnalytics[]): number {
  return data.reduce((sum, d) => sum + d.revenueCents, 0);
}

function avgOccupancy(data: BookingAnalytics[]): number {
  if (data.length === 0) return 0;
  return data.reduce((sum, d) => sum + d.occupancyPct, 0) / data.length;
}

function peakDay(data: BookingAnalytics[]): BookingAnalytics | null {
  if (data.length === 0) return null;
  return data.reduce((peak, d) => d.bookingCount > peak.bookingCount ? d : peak);
}

function revenuePerBooking(data: BookingAnalytics[]): number {
  const total = data.reduce((sum, d) => sum + d.bookingCount, 0);
  if (total === 0) return 0;
  return Math.round(totalRevenue(data) / total);
}

const DATA: BookingAnalytics[] = [
  { date: "2026-10-01", bookingCount: 10, revenueCents: 50_000, avgDurationMinutes: 120, occupancyPct: 60 },
  { date: "2026-10-02", bookingCount: 15, revenueCents: 75_000, avgDurationMinutes: 90,  occupancyPct: 80 },
  { date: "2026-10-03", bookingCount: 8,  revenueCents: 40_000, avgDurationMinutes: 150, occupancyPct: 50 },
];

describe("Venue analytics summary", () => {
  it("totalRevenue sums all days", () => {
    expect(totalRevenue(DATA)).toBe(165_000);
  });

  it("totalRevenue: empty → 0", () => {
    expect(totalRevenue([])).toBe(0);
  });

  it("avgOccupancy: (60+80+50)/3 ≈ 63.3", () => {
    expect(avgOccupancy(DATA)).toBeCloseTo(63.33);
  });

  it("avgOccupancy: empty → 0", () => {
    expect(avgOccupancy([])).toBe(0);
  });

  it("peakDay: Oct 2 has most bookings (15)", () => {
    expect(peakDay(DATA)!.date).toBe("2026-10-02");
  });

  it("peakDay: empty → null", () => {
    expect(peakDay([])).toBeNull();
  });

  it("revenuePerBooking: 165000/33 = 5000", () => {
    expect(revenuePerBooking(DATA)).toBe(5000);
  });

  it("revenuePerBooking: no bookings → 0", () => {
    const zero = DATA.map((d) => ({ ...d, bookingCount: 0 }));
    expect(revenuePerBooking(zero)).toBe(0);
  });
});
