/**
 * Tests for overall venue health score combining multiple performance signals.
 */

interface VenueHealthMetrics {
  venueId: string;
  avgRating: number;          // 0-5
  reviewCount: number;
  bookingFulfillmentRate: number; // 0-1
  responseRatePercent: number;    // 0-100
  avgResponseHours: number;
  revenueGrowthPercent: number;   // monthly growth %
  repeatBookingRate: number;      // 0-1
  cancellationRate: number;       // 0-1
  maintenanceIssuesOpen: number;
}

function ratingScore(metrics: VenueHealthMetrics): number {
  const base = (metrics.avgRating / 5) * 100;
  const confidenceBoost = Math.min(metrics.reviewCount / 100, 1) * 10;
  return Math.min(Math.round(base + confidenceBoost), 100);
}

function operationalScore(metrics: VenueHealthMetrics): number {
  const fulfillment = metrics.bookingFulfillmentRate * 40;
  const response    = (metrics.responseRatePercent / 100) * 30;
  const speed       = Math.max(0, (48 - metrics.avgResponseHours) / 48) * 20;
  const maintenance = Math.max(0, 10 - metrics.maintenanceIssuesOpen * 2);
  return Math.min(Math.round(fulfillment + response + speed + maintenance), 100);
}

function growthScore(metrics: VenueHealthMetrics): number {
  let score = 50;
  if (metrics.revenueGrowthPercent > 0) score += Math.min(metrics.revenueGrowthPercent * 2, 30);
  if (metrics.repeatBookingRate > 0.5)  score += 15;
  score -= metrics.cancellationRate * 30;
  return Math.max(0, Math.min(Math.round(score), 100));
}

function venueHealthScore(metrics: VenueHealthMetrics): number {
  return Math.round(
    ratingScore(metrics)      * 0.35 +
    operationalScore(metrics) * 0.40 +
    growthScore(metrics)      * 0.25
  );
}

function healthTier(score: number): "platinum" | "gold" | "silver" | "bronze" {
  if (score >= 85) return "platinum";
  if (score >= 70) return "gold";
  if (score >= 55) return "silver";
  return "bronze";
}

const EXCELLENT: VenueHealthMetrics = {
  venueId: "v1", avgRating: 4.8, reviewCount: 150, bookingFulfillmentRate: 0.99,
  responseRatePercent: 98, avgResponseHours: 2, revenueGrowthPercent: 8,
  repeatBookingRate: 0.65, cancellationRate: 0.02, maintenanceIssuesOpen: 0,
};
const POOR: VenueHealthMetrics = {
  venueId: "v2", avgRating: 3.0, reviewCount: 10, bookingFulfillmentRate: 0.70,
  responseRatePercent: 50, avgResponseHours: 36, revenueGrowthPercent: -5,
  repeatBookingRate: 0.2, cancellationRate: 0.25, maintenanceIssuesOpen: 5,
};

describe("Venue health score", () => {
  it("venueHealthScore: excellent venue > 80", () => {
    expect(venueHealthScore(EXCELLENT)).toBeGreaterThan(80);
  });

  it("venueHealthScore: poor venue < 60", () => {
    expect(venueHealthScore(POOR)).toBeLessThan(60);
  });

  it("healthTier: excellent → platinum or gold", () => {
    const tier = healthTier(venueHealthScore(EXCELLENT));
    expect(["platinum", "gold"]).toContain(tier);
  });

  it("healthTier: poor → bronze or silver", () => {
    const tier = healthTier(venueHealthScore(POOR));
    expect(["bronze", "silver"]).toContain(tier);
  });

  it("ratingScore: 4.8 stars, 150 reviews → near 100", () => {
    expect(ratingScore(EXCELLENT)).toBeGreaterThan(90);
  });

  it("operationalScore: 99% fulfillment, fast response → high", () => {
    expect(operationalScore(EXCELLENT)).toBeGreaterThan(80);
  });
});
