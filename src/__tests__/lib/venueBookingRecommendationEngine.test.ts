/**
 * Tests for venue booking collaborative filtering recommendation engine.
 */

interface UserBookingHistory {
  userId: string;
  venueIds: string[];
  avgRatingGiven: number;
  preferredCategories: string[];
  avgBookingValue: number;
}

interface VenueProfile {
  id: string;
  categories: string[];
  avgRating: number;
  priceRange: "budget" | "mid" | "premium" | "luxury";
  city: string;
}

function categoryMatch(user: UserBookingHistory, venue: VenueProfile): number {
  const matches = user.preferredCategories.filter((c) => venue.categories.includes(c));
  return user.preferredCategories.length > 0
    ? Math.round((matches.length / user.preferredCategories.length) * 100) / 100
    : 0;
}

function ratingCompatibility(user: UserBookingHistory, venue: VenueProfile): number {
  // User who gives high ratings prefers high-rated venues
  const ratingGap = Math.abs(user.avgRatingGiven - venue.avgRating);
  return Math.round(Math.max(0, 1 - ratingGap / 2) * 100) / 100;
}

function similarUsers(
  targetUser: UserBookingHistory,
  allUsers: UserBookingHistory[]
): UserBookingHistory[] {
  const targetVenueSet = new Set(targetUser.venueIds);
  return allUsers
    .filter((u) => u.userId !== targetUser.userId)
    .filter((u) => u.venueIds.some((v) => targetVenueSet.has(v)));
}

function recommendedVenues(
  user: UserBookingHistory,
  venues: VenueProfile[],
  limit = 3
): VenueProfile[] {
  const alreadyBooked = new Set(user.venueIds);
  return venues
    .filter((v) => !alreadyBooked.has(v.id))
    .map((v) => ({
      venue: v,
      score: categoryMatch(user, v) * 0.5 + ratingCompatibility(user, v) * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.venue);
}

const USER: UserBookingHistory = {
  userId: "u1", venueIds: ["v1", "v2"], avgRatingGiven: 4.5,
  preferredCategories: ["conference", "boardroom"], avgBookingValue: 800,
};

const VENUES: VenueProfile[] = [
  { id: "v3", categories: ["conference", "event_hall"], avgRating: 4.6, priceRange: "premium", city: "London" },
  { id: "v4", categories: ["studio", "creative"],       avgRating: 4.1, priceRange: "mid",     city: "London" },
  { id: "v5", categories: ["boardroom", "conference"],  avgRating: 4.7, priceRange: "luxury",  city: "London" },
];

describe("Recommendation engine", () => {
  it("categoryMatch: v3 shares conference → 0.5 match", () => {
    expect(categoryMatch(USER, VENUES[0])).toBe(0.5);
  });

  it("categoryMatch: v5 shares conference+boardroom → 1.0 match", () => {
    expect(categoryMatch(USER, VENUES[2])).toBe(1.0);
  });

  it("ratingCompatibility: user 4.5 vs venue 4.6 → near 1", () => {
    expect(ratingCompatibility(USER, VENUES[0])).toBeGreaterThan(0.9);
  });

  it("recommendedVenues: v5 should rank highly (both categories match)", () => {
    const recs = recommendedVenues(USER, VENUES);
    expect(recs[0].id).toBe("v5");
  });

  it("recommendedVenues: excludes already booked venues", () => {
    const recs = recommendedVenues(USER, [...VENUES, { id: "v1", categories: ["conference"], avgRating: 5, priceRange: "luxury", city: "London" }]);
    expect(recs.map((v) => v.id)).not.toContain("v1");
  });
});
