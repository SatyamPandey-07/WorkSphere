/**
 * Tests for venue composite quality scoring system.
 */

interface VenueScoreComponents {
  venueId: string;
  avgReviewScore: number;      // 0-5
  reviewCount: number;
  responseRate: number;        // 0-1 (how often venue responds to enquiries)
  avgResponseHours: number;
  bookingFulfillmentRate: number; // 0-1 (no cancellations)
  amenityScore: number;        // 0-100
  locationScore: number;       // 0-100
  priceCompetitiveness: number;// 0-100
}

const WEIGHTS = {
  review: 0.35,
  response: 0.15,
  fulfillment: 0.20,
  amenity: 0.10,
  location: 0.10,
  price: 0.10,
};

function reviewComponent(components: VenueScoreComponents): number {
  const base = (components.avgReviewScore / 5) * 100;
  const confidenceBoost = Math.min(components.reviewCount / 50, 1) * 10;
  return Math.min(base + confidenceBoost, 100);
}

function responseComponent(components: VenueScoreComponents): number {
  const rateScore = components.responseRate * 60;
  const speedScore = Math.max(0, (48 - components.avgResponseHours) / 48) * 40;
  return Math.min(rateScore + speedScore, 100);
}

function compositeScore(components: VenueScoreComponents): number {
  const review      = reviewComponent(components);
  const response    = responseComponent(components);
  const fulfillment = components.bookingFulfillmentRate * 100;
  const amenity     = components.amenityScore;
  const location    = components.locationScore;
  const price       = components.priceCompetitiveness;

  return Math.round(
    review      * WEIGHTS.review +
    response    * WEIGHTS.response +
    fulfillment * WEIGHTS.fulfillment +
    amenity     * WEIGHTS.amenity +
    location    * WEIGHTS.location +
    price       * WEIGHTS.price
  );
}

function qualityTier(score: number): "premier" | "standard" | "basic" {
  if (score >= 80) return "premier";
  if (score >= 60) return "standard";
  return "basic";
}

const EXCELLENT: VenueScoreComponents = {
  venueId: "v1", avgReviewScore: 4.8, reviewCount: 120, responseRate: 0.97,
  avgResponseHours: 2, bookingFulfillmentRate: 0.99, amenityScore: 90,
  locationScore: 88, priceCompetitiveness: 75,
};
const AVERAGE: VenueScoreComponents = {
  venueId: "v2", avgReviewScore: 3.5, reviewCount: 20, responseRate: 0.70,
  avgResponseHours: 24, bookingFulfillmentRate: 0.85, amenityScore: 50,
  locationScore: 55, priceCompetitiveness: 60,
};

describe("Venue composite quality scoring", () => {
  it("compositeScore: excellent venue scores above 80", () => {
    expect(compositeScore(EXCELLENT)).toBeGreaterThan(80);
  });

  it("compositeScore: average venue scores below 80", () => {
    expect(compositeScore(AVERAGE)).toBeLessThan(80);
  });

  it("qualityTier: excellent → premier", () => {
    expect(qualityTier(compositeScore(EXCELLENT))).toBe("premier");
  });

  it("reviewComponent: high reviews + many reviews > just high reviews", () => {
    const many = { ...EXCELLENT, reviewCount: 100 };
    const few  = { ...EXCELLENT, reviewCount: 5 };
    expect(reviewComponent(many)).toBeGreaterThanOrEqual(reviewComponent(few));
  });

  it("responseComponent: fast responder scores higher", () => {
    const fast = responseComponent(EXCELLENT);
    const slow = responseComponent(AVERAGE);
    expect(fast).toBeGreaterThan(slow);
  });
});
