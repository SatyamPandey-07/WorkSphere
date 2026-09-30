/**
 * Tests for venue leaderboard ranking calculation.
 */

interface VenueScore {
  venueId: string;
  rating: number;
  bookingCount: number;
  favoriteCount: number;
}

function computeRankScore(v: VenueScore): number {
  return v.rating * 40 + v.bookingCount * 0.3 + v.favoriteCount * 0.2;
}

function rankVenues(venues: VenueScore[]): VenueScore[] {
  return [...venues].sort((a, b) => computeRankScore(b) - computeRankScore(a));
}

function rankOf(venues: VenueScore[], venueId: string): number {
  const ranked = rankVenues(venues);
  const idx = ranked.findIndex((v) => v.venueId === venueId);
  return idx === -1 ? -1 : idx + 1;
}

const SCORES: VenueScore[] = [
  { venueId: "v1", rating: 5.0, bookingCount: 100, favoriteCount: 50 },
  { venueId: "v2", rating: 4.5, bookingCount: 200, favoriteCount: 80 },
  { venueId: "v3", rating: 3.0, bookingCount: 500, favoriteCount: 200 },
];

describe("Venue leaderboard ranking", () => {
  it("highest combined score ranks first", () => {
    // v1: 5*40 + 100*0.3 + 50*0.2 = 200+30+10 = 240
    // v2: 4.5*40 + 200*0.3 + 80*0.2 = 180+60+16 = 256
    // v3: 3*40 + 500*0.3 + 200*0.2 = 120+150+40 = 310
    const ranked = rankVenues(SCORES);
    expect(ranked[0].venueId).toBe("v3");
  });

  it("rankOf returns 1-indexed position", () => {
    expect(rankOf(SCORES, "v3")).toBe(1);
  });

  it("rankOf unknown venue → -1", () => {
    expect(rankOf(SCORES, "v99")).toBe(-1);
  });

  it("no mutation to original array", () => {
    const original = SCORES.map((s) => s.venueId);
    rankVenues(SCORES);
    expect(SCORES.map((s) => s.venueId)).toEqual(original);
  });

  it("empty list → empty ranking", () => {
    expect(rankVenues([])).toHaveLength(0);
  });

  it("single venue ranks 1", () => {
    expect(rankOf([SCORES[0]], "v1")).toBe(1);
  });

  it("computeRankScore formula correct for v1", () => {
    expect(computeRankScore(SCORES[0])).toBeCloseTo(240);
  });
});
