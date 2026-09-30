/**
 * Tests for booking platform analytics dashboard metrics.
 */

interface PlatformMetrics {
  date: string;
  activeVenues: number;
  totalBookings: number;
  totalRevenueCents: number;
  newUsers: number;
  activeUsers: number;
  avgBookingValueCents: number;
  platformFeeCents: number;
}

function platformGrowthRate(current: PlatformMetrics, previous: PlatformMetrics): number {
  if (previous.totalBookings === 0) return 0;
  return Math.round(((current.totalBookings - previous.totalBookings) / previous.totalBookings) * 100);
}

function platformTakeRate(metrics: PlatformMetrics): number {
  if (metrics.totalRevenueCents === 0) return 0;
  return Math.round((metrics.platformFeeCents / metrics.totalRevenueCents) * 100 * 10) / 10;
}

function userActivationRate(metrics: PlatformMetrics): number {
  if (metrics.newUsers === 0) return 0;
  return Math.round((metrics.activeUsers / Math.max(metrics.newUsers, 1)) * 100);
}

function platformHealthScore(metrics: PlatformMetrics): number {
  const bookingPerVenue = metrics.totalBookings / Math.max(metrics.activeVenues, 1);
  const avgValue = metrics.avgBookingValueCents;
  const userEngagement = userActivationRate(metrics);
  const takeRate = platformTakeRate(metrics);

  return Math.round(
    (Math.min(bookingPerVenue / 5, 1) * 30) +
    (Math.min(avgValue / 10000, 1) * 25) +
    (userEngagement / 100 * 25) +
    (Math.min(takeRate / 15, 1) * 20)
  );
}

const CURRENT: PlatformMetrics = {
  date: "2026-10-01", activeVenues: 100, totalBookings: 500,
  totalRevenueCents: 2_500_000, newUsers: 200, activeUsers: 180,
  avgBookingValueCents: 5000, platformFeeCents: 250_000,
};

const PREVIOUS: PlatformMetrics = {
  date: "2026-09-01", activeVenues: 85, totalBookings: 400,
  totalRevenueCents: 2_000_000, newUsers: 160, activeUsers: 130,
  avgBookingValueCents: 5000, platformFeeCents: 200_000,
};

describe("Venue booking platform analytics", () => {
  it("platformGrowthRate: 400→500 bookings = 25%", () => {
    expect(platformGrowthRate(CURRENT, PREVIOUS)).toBe(25);
  });

  it("platformGrowthRate: zero previous → 0", () => {
    const zeroPrev = { ...PREVIOUS, totalBookings: 0 };
    expect(platformGrowthRate(CURRENT, zeroPrev)).toBe(0);
  });

  it("platformTakeRate: 250000/2500000 = 10%", () => {
    expect(platformTakeRate(CURRENT)).toBe(10);
  });

  it("userActivationRate: 180/200 = 90%", () => {
    expect(userActivationRate(CURRENT)).toBe(90);
  });

  it("platformHealthScore: healthy platform → good score", () => {
    expect(platformHealthScore(CURRENT)).toBeGreaterThan(60);
  });

  it("platformHealthScore: all zeros → 0", () => {
    const empty: PlatformMetrics = {
      date: "2026-10-01", activeVenues: 0, totalBookings: 0,
      totalRevenueCents: 0, newUsers: 0, activeUsers: 0,
      avgBookingValueCents: 0, platformFeeCents: 0,
    };
    expect(platformHealthScore(empty)).toBe(0);
  });
});
