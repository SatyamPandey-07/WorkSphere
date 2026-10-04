/**
 * Tests for venue booking collaborative filtering utilities.
 */

interface UserProfile {
  userId: string;
  bookedVenueIds: string[];
  avgRatingGiven: number;
  preferredCategories: string[];
}

interface VenueItem {
  id: string;
  categories: string[];
  avgRating: number;
}

function jaccardSimilarity(setA: string[], setB: string[]): number {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100) / 100;
}

function userSimilarity(u1: UserProfile, u2: UserProfile): number {
  return jaccardSimilarity(u1.bookedVenueIds, u2.bookedVenueIds);
}

function categoryScore(user: UserProfile, venue: VenueItem): number {
  const matches = user.preferredCategories.filter((c) => venue.categories.includes(c));
  return user.preferredCategories.length > 0 ? matches.length / user.preferredCategories.length : 0;
}

function ratingScore(user: UserProfile, venue: VenueItem): number {
  const diff = Math.abs(user.avgRatingGiven - venue.avgRating);
  return Math.max(0, 1 - diff / 2);
}

function hybridScore(user: UserProfile, venue: VenueItem): number {
  return Math.round((categoryScore(user, venue) * 0.6 + ratingScore(user, venue) * 0.4) * 100) / 100;
}

const U1: UserProfile = { userId: "u1", bookedVenueIds: ["v1","v2","v3"], avgRatingGiven: 4.5, preferredCategories: ["conference","boardroom"] };
const U2: UserProfile = { userId: "u2", bookedVenueIds: ["v2","v3","v4"], avgRatingGiven: 4.2, preferredCategories: ["conference","workshop"] };

const VENUES: VenueItem[] = [
  { id: "v5", categories: ["conference","boardroom"], avgRating: 4.6 },
  { id: "v6", categories: ["studio"],                avgRating: 3.8 },
];

describe("Collaborative filtering utilities", () => {
  it("jaccardSimilarity: identical sets → 1", () => {
    expect(jaccardSimilarity(["a","b"], ["a","b"])).toBe(1);
  });

  it("jaccardSimilarity: no overlap → 0", () => {
    expect(jaccardSimilarity(["a"], ["b"])).toBe(0);
  });

  it("userSimilarity: u1 and u2 share v2,v3 of 5 total → 0.4", () => {
    expect(userSimilarity(U1, U2)).toBe(0.4);
  });

  it("categoryScore: v5 matches conference+boardroom → 1", () => {
    expect(categoryScore(U1, VENUES[0])).toBe(1);
  });

  it("hybridScore: v5 scores higher than v6 for u1", () => {
    expect(hybridScore(U1, VENUES[0])).toBeGreaterThan(hybridScore(U1, VENUES[1]));
  });
});
