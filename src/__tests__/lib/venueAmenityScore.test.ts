/**
 * Tests for venue amenity completeness score calculation.
 */

interface VenueAmenities {
  wifi: boolean;
  powerOutlets: boolean;
  parking: boolean;
  naturalLight: boolean;
  airConditioning: boolean;
  kitchen: boolean;
  meetingRooms: boolean;
  printing: boolean;
}

const AMENITY_WEIGHTS: Record<keyof VenueAmenities, number> = {
  wifi:            30,
  powerOutlets:    20,
  parking:         10,
  naturalLight:    10,
  airConditioning:  5,
  kitchen:          5,
  meetingRooms:    15,
  printing:         5,
};

function amenityScore(amenities: VenueAmenities): number {
  return (Object.entries(amenities) as [keyof VenueAmenities, boolean][])
    .filter(([, v]) => v)
    .reduce((sum, [k]) => sum + AMENITY_WEIGHTS[k], 0);
}

function amenityGrade(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

const FULL: VenueAmenities = {
  wifi: true, powerOutlets: true, parking: true, naturalLight: true,
  airConditioning: true, kitchen: true, meetingRooms: true, printing: true,
};
const BARE: VenueAmenities = {
  wifi: false, powerOutlets: false, parking: false, naturalLight: false,
  airConditioning: false, kitchen: false, meetingRooms: false, printing: false,
};

describe("Venue amenity score", () => {
  it("full amenities → 100", () => {
    expect(amenityScore(FULL)).toBe(100);
  });

  it("no amenities → 0", () => {
    expect(amenityScore(BARE)).toBe(0);
  });

  it("wifi only → 30", () => {
    expect(amenityScore({ ...BARE, wifi: true })).toBe(30);
  });

  it("wifi + outlets → 50", () => {
    expect(amenityScore({ ...BARE, wifi: true, powerOutlets: true })).toBe(50);
  });

  it("grade A for score ≥ 80", () => {
    expect(amenityGrade(85)).toBe("A");
  });

  it("grade B for score 60–79", () => {
    expect(amenityGrade(65)).toBe("B");
  });

  it("grade C for score 40–59", () => {
    expect(amenityGrade(45)).toBe("C");
  });

  it("grade D for score < 40", () => {
    expect(amenityGrade(30)).toBe("D");
  });

  it("full amenities grade A", () => {
    expect(amenityGrade(amenityScore(FULL))).toBe("A");
  });
});
