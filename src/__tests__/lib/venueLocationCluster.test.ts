/**
 * Tests for venue location clustering by neighborhood.
 */

interface VenueLocation {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
  neighborhood?: string;
}

function groupByNeighborhood(
  venues: VenueLocation[]
): Record<string, VenueLocation[]> {
  const groups: Record<string, VenueLocation[]> = {};
  for (const venue of venues) {
    const hood = venue.neighborhood ?? "Other";
    if (!groups[hood]) groups[hood] = [];
    groups[hood].push(venue);
  }
  return groups;
}

function nearbyVenues(
  venues: VenueLocation[],
  centerLat: number,
  centerLng: number,
  radiusDeg: number
): VenueLocation[] {
  return venues.filter(
    (v) =>
      Math.abs(v.lat - centerLat) <= radiusDeg &&
      Math.abs(v.lng - centerLng) <= radiusDeg
  );
}

function centroidOf(venues: VenueLocation[]): { lat: number; lng: number } | null {
  if (venues.length === 0) return null;
  return {
    lat: venues.reduce((s, v) => s + v.lat, 0) / venues.length,
    lng: venues.reduce((s, v) => s + v.lng, 0) / venues.length,
  };
}

const VENUES: VenueLocation[] = [
  { venueId: "v1", name: "Café A",  lat: 40.7, lng: -74.0, neighborhood: "Downtown" },
  { venueId: "v2", name: "Hub B",   lat: 40.8, lng: -74.1, neighborhood: "Midtown"  },
  { venueId: "v3", name: "Space C", lat: 40.7, lng: -74.0, neighborhood: "Downtown" },
  { venueId: "v4", name: "Desk D",  lat: 41.0, lng: -73.8                           }, // no neighborhood
];

describe("Venue location clustering", () => {
  it("groupByNeighborhood: Downtown has 2", () => {
    const groups = groupByNeighborhood(VENUES);
    expect(groups["Downtown"]).toHaveLength(2);
  });

  it("groupByNeighborhood: no neighborhood → 'Other'", () => {
    const groups = groupByNeighborhood(VENUES);
    expect(groups["Other"]).toHaveLength(1);
  });

  it("nearbyVenues: within 0.15 deg of 40.75, -74.05", () => {
    const nearby = nearbyVenues(VENUES, 40.75, -74.05, 0.15);
    expect(nearby.length).toBeGreaterThan(0);
  });

  it("nearbyVenues: tight radius excludes far venues", () => {
    const nearby = nearbyVenues(VENUES, 40.7, -74.0, 0.05);
    expect(nearby.every((v) => v.neighborhood === "Downtown")).toBe(true);
  });

  it("centroidOf: average lat/lng", () => {
    const c = centroidOf([VENUES[0], VENUES[2]])!;
    expect(c.lat).toBeCloseTo(40.7);
    expect(c.lng).toBeCloseTo(-74.0);
  });

  it("centroidOf: empty → null", () => {
    expect(centroidOf([])).toBeNull();
  });
});
