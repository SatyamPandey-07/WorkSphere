/**
 * Tests for venue listing quality score for platform ranking.
 */

interface ListingQualityFactors {
  hasPhotos: boolean;
  photosCount: number;
  hasDescription: boolean;
  descriptionLength: number;
  hasPricing: boolean;
  hasAmenities: boolean;
  amenitiesCount: number;
  hasOperatingHours: boolean;
  responseRatePercent: number; // owner's reply rate to inquiries
  avgRating: number;
}

function listingQualityScore(factors: ListingQualityFactors): number {
  let score = 0;

  if (factors.hasPhotos) {
    score += Math.min(factors.photosCount * 3, 20); // up to 20 pts for photos
  }
  if (factors.hasDescription && factors.descriptionLength >= 50) score += 15;
  if (factors.hasPricing) score += 10;
  if (factors.hasAmenities) {
    score += Math.min(factors.amenitiesCount * 2, 15);
  }
  if (factors.hasOperatingHours) score += 10;
  score += Math.round(factors.responseRatePercent * 0.2); // up to 20 pts
  score += Math.round(factors.avgRating * 2); // up to 10 pts for 5-star

  return Math.min(score, 100);
}

function listingGrade(score: number): "poor" | "fair" | "good" | "excellent" {
  if (score >= 85) return "excellent";
  if (score >= 65) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

const COMPLETE_FACTORS: ListingQualityFactors = {
  hasPhotos: true, photosCount: 10,
  hasDescription: true, descriptionLength: 200,
  hasPricing: true, hasAmenities: true, amenitiesCount: 8,
  hasOperatingHours: true, responseRatePercent: 95, avgRating: 4.8,
};

const MINIMAL_FACTORS: ListingQualityFactors = {
  hasPhotos: false, photosCount: 0,
  hasDescription: false, descriptionLength: 0,
  hasPricing: false, hasAmenities: false, amenitiesCount: 0,
  hasOperatingHours: false, responseRatePercent: 0, avgRating: 0,
};

describe("Venue listing quality score", () => {
  it("complete listing → high score", () => {
    expect(listingQualityScore(COMPLETE_FACTORS)).toBeGreaterThan(80);
  });

  it("minimal listing → 0", () => {
    expect(listingQualityScore(MINIMAL_FACTORS)).toBe(0);
  });

  it("photos capped at 20 pts", () => {
    const manyPhotos: ListingQualityFactors = { ...MINIMAL_FACTORS, hasPhotos: true, photosCount: 100 };
    expect(listingQualityScore(manyPhotos)).toBe(20);
  });

  it("score capped at 100", () => {
    expect(listingQualityScore(COMPLETE_FACTORS)).toBeLessThanOrEqual(100);
  });

  it("listingGrade: excellent for high score", () => {
    expect(listingGrade(90)).toBe("excellent");
  });

  it("listingGrade: poor for low score", () => {
    expect(listingGrade(20)).toBe("poor");
  });

  it("listingGrade: good for 65-84", () => {
    expect(listingGrade(75)).toBe("good");
  });
});
