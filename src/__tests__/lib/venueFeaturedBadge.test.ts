/**
 * Tests for venue featured badge eligibility criteria.
 */

interface VenueMetrics {
  venueId: string;
  avgRating: number;
  totalReviews: number;
  bookingsLastMonth: number;
  responseTimeMinutes: number; // owner response time
  profileCompleteness: number; // 0-100
  isVerified: boolean;
}

function isFeaturedEligible(metrics: VenueMetrics): boolean {
  return (
    metrics.avgRating >= 4.5 &&
    metrics.totalReviews >= 10 &&
    metrics.bookingsLastMonth >= 5 &&
    metrics.responseTimeMinutes <= 60 &&
    metrics.profileCompleteness >= 90 &&
    metrics.isVerified
  );
}

function eligibilityGap(metrics: VenueMetrics): string[] {
  const gaps: string[] = [];
  if (metrics.avgRating < 4.5) gaps.push(`Rating ${metrics.avgRating} < 4.5`);
  if (metrics.totalReviews < 10) gaps.push(`Reviews ${metrics.totalReviews} < 10`);
  if (metrics.bookingsLastMonth < 5) gaps.push(`Bookings ${metrics.bookingsLastMonth} < 5`);
  if (metrics.responseTimeMinutes > 60) gaps.push(`Response time > 60 min`);
  if (metrics.profileCompleteness < 90) gaps.push(`Profile ${metrics.profileCompleteness}% < 90%`);
  if (!metrics.isVerified) gaps.push("Not verified");
  return gaps;
}

const ELIGIBLE: VenueMetrics = {
  venueId: "v1", avgRating: 4.8, totalReviews: 25, bookingsLastMonth: 12,
  responseTimeMinutes: 30, profileCompleteness: 95, isVerified: true,
};

describe("Venue featured badge eligibility", () => {
  it("eligible venue → true", () => {
    expect(isFeaturedEligible(ELIGIBLE)).toBe(true);
  });

  it("low rating → not eligible", () => {
    expect(isFeaturedEligible({ ...ELIGIBLE, avgRating: 4.0 })).toBe(false);
  });

  it("few reviews → not eligible", () => {
    expect(isFeaturedEligible({ ...ELIGIBLE, totalReviews: 5 })).toBe(false);
  });

  it("slow response → not eligible", () => {
    expect(isFeaturedEligible({ ...ELIGIBLE, responseTimeMinutes: 120 })).toBe(false);
  });

  it("unverified → not eligible", () => {
    expect(isFeaturedEligible({ ...ELIGIBLE, isVerified: false })).toBe(false);
  });

  it("eligibilityGap: empty when eligible", () => {
    expect(eligibilityGap(ELIGIBLE)).toHaveLength(0);
  });

  it("eligibilityGap: lists rating and verification issues", () => {
    const gaps = eligibilityGap({ ...ELIGIBLE, avgRating: 4.0, isVerified: false });
    expect(gaps.some((g) => /Rating/i.test(g))).toBe(true);
    expect(gaps.some((g) => /verified/i.test(g))).toBe(true);
  });
});
