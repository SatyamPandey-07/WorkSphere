/**
 * Tests for multi-venue comparison and ranking utilities.
 */

interface VenueMetrics {
  id: string;
  name: string;
  pricePerHour: number;
  capacityMax: number;
  avgRating: number;      // 0-5
  amenityCount: number;
  distanceKm: number;
  availabilityScore: number; // 0-1 (fraction of days available)
}

type CompareWeight = {
  price: number;
  rating: number;
  amenity: number;
  distance: number;
  availability: number;
};

const DEFAULT_WEIGHTS: CompareWeight = {
  price: 0.25, rating: 0.3, amenity: 0.15, distance: 0.2, availability: 0.1,
};

function normalise(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 0.5;
  const norm = (value - min) / (max - min);
  return invert ? 1 - norm : norm;
}

function venueScore(
  venue: VenueMetrics,
  all: VenueMetrics[],
  weights: CompareWeight = DEFAULT_WEIGHTS
): number {
  const prices   = all.map((v) => v.pricePerHour);
  const ratings  = all.map((v) => v.avgRating);
  const amenities= all.map((v) => v.amenityCount);
  const distances= all.map((v) => v.distanceKm);

  const priceScore     = normalise(venue.pricePerHour,   Math.min(...prices),    Math.max(...prices),    true);
  const ratingScore    = normalise(venue.avgRating,      Math.min(...ratings),   Math.max(...ratings));
  const amenityScore   = normalise(venue.amenityCount,   Math.min(...amenities), Math.max(...amenities));
  const distanceScore  = normalise(venue.distanceKm,     Math.min(...distances), Math.max(...distances), true);
  const availScore     = venue.availabilityScore;

  return Math.round(
    (priceScore * weights.price +
     ratingScore * weights.rating +
     amenityScore * weights.amenity +
     distanceScore * weights.distance +
     availScore * weights.availability) * 100
  );
}

function rankVenues(venues: VenueMetrics[]): VenueMetrics[] {
  return [...venues].sort((a, b) => venueScore(b, venues) - venueScore(a, venues));
}

function filterByCapacity(venues: VenueMetrics[], minCapacity: number): VenueMetrics[] {
  return venues.filter((v) => v.capacityMax >= minCapacity);
}

const VENUES: VenueMetrics[] = [
  { id: "v1", name: "Prestige Hall",  pricePerHour: 200, capacityMax: 500, avgRating: 4.8, amenityCount: 15, distanceKm: 2,  availabilityScore: 0.9 },
  { id: "v2", name: "Budget Studio",  pricePerHour: 50,  capacityMax: 50,  avgRating: 3.8, amenityCount: 5,  distanceKm: 0.5,availabilityScore: 0.95 },
  { id: "v3", name: "Mid-range Space",pricePerHour: 120, capacityMax: 200, avgRating: 4.3, amenityCount: 10, distanceKm: 5,  availabilityScore: 0.7 },
];

describe("Multi-venue comparison", () => {
  it("venueScore: returns 0-100 integer", () => {
    const score = venueScore(VENUES[0], VENUES);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rankVenues: returns same count", () => {
    expect(rankVenues(VENUES).length).toBe(VENUES.length);
  });

  it("rankVenues: immutable", () => {
    const ids = VENUES.map((v) => v.id);
    rankVenues(VENUES);
    expect(VENUES.map((v) => v.id)).toEqual(ids);
  });

  it("filterByCapacity: 200+ capacity returns 2 venues", () => {
    expect(filterByCapacity(VENUES, 200).length).toBe(2);
  });

  it("normalise: invert puts low value at top", () => {
    const n = normalise(50, 50, 200, true);
    expect(n).toBe(1);
  });
});
