/**
 * Tests for venue owner dashboard metric calculations.
 */

interface DashboardPeriod {
  startMs: number;
  endMs: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  grossRevenueCents: number;
  refundedCents: number;
  avgRating: number;
  newReviews: number;
}

function netRevenue(period: DashboardPeriod): number {
  return period.grossRevenueCents - period.refundedCents;
}

function completionRate(period: DashboardPeriod): number {
  if (period.totalBookings === 0) return 0;
  return Math.round((period.completedBookings / period.totalBookings) * 100);
}

function cancellationRate(period: DashboardPeriod): number {
  if (period.totalBookings === 0) return 0;
  return Math.round((period.cancelledBookings / period.totalBookings) * 100);
}

function revenuePerBooking(period: DashboardPeriod): number {
  if (period.completedBookings === 0) return 0;
  return Math.round(netRevenue(period) / period.completedBookings);
}

function periodDurationDays(period: DashboardPeriod): number {
  return Math.round((period.endMs - period.startMs) / 86_400_000);
}

const NOW = 1_700_000_000_000;
const PERIOD: DashboardPeriod = {
  startMs: NOW - 30 * 86_400_000, endMs: NOW,
  totalBookings: 100, completedBookings: 80, cancelledBookings: 15,
  grossRevenueCents: 500_000, refundedCents: 25_000,
  avgRating: 4.2, newReviews: 30,
};

describe("Venue owner dashboard metrics", () => {
  it("netRevenue: 500000 - 25000 = 475000", () => {
    expect(netRevenue(PERIOD)).toBe(475_000);
  });

  it("completionRate: 80/100 = 80%", () => {
    expect(completionRate(PERIOD)).toBe(80);
  });

  it("completionRate: 0 bookings → 0", () => {
    expect(completionRate({ ...PERIOD, totalBookings: 0 })).toBe(0);
  });

  it("cancellationRate: 15/100 = 15%", () => {
    expect(cancellationRate(PERIOD)).toBe(15);
  });

  it("revenuePerBooking: 475000/80 ≈ 5938", () => {
    expect(revenuePerBooking(PERIOD)).toBe(5938);
  });

  it("revenuePerBooking: 0 completed → 0", () => {
    expect(revenuePerBooking({ ...PERIOD, completedBookings: 0 })).toBe(0);
  });

  it("periodDurationDays: 30 days", () => {
    expect(periodDurationDays(PERIOD)).toBe(30);
  });
});
