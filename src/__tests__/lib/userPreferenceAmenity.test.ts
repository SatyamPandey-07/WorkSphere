/**
 * Tests for user amenity preference learning from booking history.
 */

type AmenityKey = "wifi" | "outlets" | "quiet" | "coffee" | "standing_desk" | "natural_light" | "private" | "collaborative";

interface BookingWithAmenities {
  bookingId: string;
  userId: string;
  rating: number;    // 1-5 post-booking
  amenitiesPresent: AmenityKey[];
}

function learnAmenityPreferences(
  history: BookingWithAmenities[],
  userId: string,
  minRating = 4
): Record<AmenityKey, number> {
  const counts: Record<string, number> = {};
  const goodBookings = history.filter(
    (b) => b.userId === userId && b.rating >= minRating
  );
  for (const booking of goodBookings) {
    for (const amenity of booking.amenitiesPresent) {
      counts[amenity] = (counts[amenity] ?? 0) + 1;
    }
  }
  return counts as Record<AmenityKey, number>;
}

function topPreferredAmenities(
  history: BookingWithAmenities[],
  userId: string,
  limit = 3
): AmenityKey[] {
  const prefs = learnAmenityPreferences(history, userId);
  return Object.entries(prefs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k as AmenityKey);
}

function matchesUserPreferences(
  venueAmenities: AmenityKey[],
  userPrefs: AmenityKey[],
  minMatch: number
): boolean {
  const matches = userPrefs.filter((p) => venueAmenities.includes(p)).length;
  return matches >= minMatch;
}

const HISTORY: BookingWithAmenities[] = [
  { bookingId: "b1", userId: "u1", rating: 5, amenitiesPresent: ["wifi", "outlets", "quiet", "coffee"] },
  { bookingId: "b2", userId: "u1", rating: 4, amenitiesPresent: ["wifi", "outlets", "natural_light"]    },
  { bookingId: "b3", userId: "u1", rating: 2, amenitiesPresent: ["coffee", "collaborative"]              }, // low rating
  { bookingId: "b4", userId: "u2", rating: 5, amenitiesPresent: ["private", "standing_desk"]             },
];

describe("User amenity preference learning", () => {
  it("learnAmenityPreferences: counts from high-rated bookings", () => {
    const prefs = learnAmenityPreferences(HISTORY, "u1");
    expect(prefs["wifi"]).toBe(2);
    expect(prefs["outlets"]).toBe(2);
  });

  it("learnAmenityPreferences: excludes low-rated bookings", () => {
    const prefs = learnAmenityPreferences(HISTORY, "u1");
    expect(prefs["collaborative"]).toBeUndefined();
  });

  it("topPreferredAmenities: wifi and outlets are top", () => {
    const top = topPreferredAmenities(HISTORY, "u1", 3);
    expect(top).toContain("wifi");
    expect(top).toContain("outlets");
  });

  it("topPreferredAmenities: limited to 3", () => {
    expect(topPreferredAmenities(HISTORY, "u1")).toHaveLength(3);
  });

  it("matchesUserPreferences: 2 of 3 required matches", () => {
    const prefs: AmenityKey[] = ["wifi", "quiet", "private"];
    const venue: AmenityKey[] = ["wifi", "quiet", "coffee"];
    expect(matchesUserPreferences(venue, prefs, 2)).toBe(true);
  });

  it("matchesUserPreferences: insufficient matches", () => {
    const prefs: AmenityKey[] = ["wifi", "quiet", "private"];
    const venue: AmenityKey[] = ["coffee", "collaborative"];
    expect(matchesUserPreferences(venue, prefs, 2)).toBe(false);
  });
});
