/**
 * Tests for venue rating distribution analysis (star ratings breakdown).
 */

interface RatingDistribution {
  venueId: string;
  oneStar: number;
  twoStar: number;
  threeStar: number;
  fourStar: number;
  fiveStar: number;
}

function totalRatings(dist: RatingDistribution): number {
  return dist.oneStar + dist.twoStar + dist.threeStar + dist.fourStar + dist.fiveStar;
}

function weightedAverage(dist: RatingDistribution): number {
  const total = totalRatings(dist);
  if (total === 0) return 0;
  const sum = dist.oneStar * 1 + dist.twoStar * 2 + dist.threeStar * 3 + dist.fourStar * 4 + dist.fiveStar * 5;
  return Math.round((sum / total) * 10) / 10;
}

function percentageForStar(dist: RatingDistribution, star: 1 | 2 | 3 | 4 | 5): number {
  const total = totalRatings(dist);
  if (total === 0) return 0;
  const counts = { 1: dist.oneStar, 2: dist.twoStar, 3: dist.threeStar, 4: dist.fourStar, 5: dist.fiveStar };
  return Math.round((counts[star] / total) * 100);
}

function satisfactionScore(dist: RatingDistribution): number {
  const total = totalRatings(dist);
  if (total === 0) return 0;
  const positive = dist.fourStar + dist.fiveStar;
  return Math.round((positive / total) * 100);
}

function addRating(dist: RatingDistribution, stars: 1 | 2 | 3 | 4 | 5): RatingDistribution {
  const keys: Record<number, keyof RatingDistribution> = {
    1: "oneStar", 2: "twoStar", 3: "threeStar", 4: "fourStar", 5: "fiveStar",
  };
  const key = keys[stars];
  return { ...dist, [key]: (dist[key] as number) + 1 };
}

const DIST: RatingDistribution = {
  venueId: "v1", oneStar: 2, twoStar: 3, threeStar: 10, fourStar: 25, fiveStar: 60,
};

describe("Venue rating distribution", () => {
  it("totalRatings: 2+3+10+25+60 = 100", () => {
    expect(totalRatings(DIST)).toBe(100);
  });

  it("weightedAverage: ≈4.4", () => {
    const avg = weightedAverage(DIST);
    expect(avg).toBeGreaterThan(4.0);
    expect(avg).toBeLessThan(5.0);
  });

  it("percentageForStar: 5-star = 60%", () => {
    expect(percentageForStar(DIST, 5)).toBe(60);
  });

  it("percentageForStar: 1-star = 2%", () => {
    expect(percentageForStar(DIST, 1)).toBe(2);
  });

  it("satisfactionScore: (25+60)/100 = 85%", () => {
    expect(satisfactionScore(DIST)).toBe(85);
  });

  it("satisfactionScore: all 1-star → 0%", () => {
    const bad: RatingDistribution = { venueId: "v2", oneStar: 10, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 };
    expect(satisfactionScore(bad)).toBe(0);
  });

  it("addRating: increments correct star count", () => {
    const updated = addRating(DIST, 5);
    expect(updated.fiveStar).toBe(61);
    expect(totalRatings(updated)).toBe(101);
  });

  it("addRating is immutable", () => {
    addRating(DIST, 5);
    expect(DIST.fiveStar).toBe(60);
  });
});
