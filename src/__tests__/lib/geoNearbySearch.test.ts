/**
 * Tests for geographic nearby venue search with bounding box optimization.
 */

interface GeoPoint {
  lat: number;
  lng: number;
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const hav =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

interface GeoVenue {
  venueId: string;
  location: GeoPoint;
}

function nearbyVenuesSorted(
  venues: GeoVenue[],
  center: GeoPoint,
  maxKm: number
): (GeoVenue & { distanceKm: number })[] {
  return venues
    .map((v) => ({ ...v, distanceKm: haversineKm(center, v.location) }))
    .filter((v) => v.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function closestVenue(venues: GeoVenue[], center: GeoPoint): GeoVenue | null {
  if (venues.length === 0) return null;
  return venues.reduce((closest, v) =>
    haversineKm(center, v.location) < haversineKm(center, closest.location) ? v : closest
  );
}

const CENTER: GeoPoint = { lat: 40.7128, lng: -74.006 };
const VENUES: GeoVenue[] = [
  { venueId: "v1", location: { lat: 40.715, lng: -74.01  } }, // ~0.4 km
  { venueId: "v2", location: { lat: 40.75,  lng: -74.0   } }, // ~4 km
  { venueId: "v3", location: { lat: 41.0,   lng: -74.5   } }, // ~40+ km
];

describe("Geo nearby venue search", () => {
  it("haversineKm: same point → 0", () => {
    expect(haversineKm(CENTER, CENTER)).toBeCloseTo(0);
  });

  it("nearbyVenuesSorted: within 5km returns 2 venues", () => {
    const results = nearbyVenuesSorted(VENUES, CENTER, 5);
    expect(results).toHaveLength(2);
  });

  it("nearbyVenuesSorted: sorted by distance ascending", () => {
    const results = nearbyVenuesSorted(VENUES, CENTER, 10);
    expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm);
  });

  it("nearbyVenuesSorted: far venue excluded", () => {
    const results = nearbyVenuesSorted(VENUES, CENTER, 5);
    expect(results.map((r) => r.venueId)).not.toContain("v3");
  });

  it("closestVenue: v1 is closest", () => {
    expect(closestVenue(VENUES, CENTER)!.venueId).toBe("v1");
  });

  it("closestVenue: empty list → null", () => {
    expect(closestVenue([], CENTER)).toBeNull();
  });

  it("nearbyVenuesSorted: all venues excluded → empty", () => {
    expect(nearbyVenuesSorted(VENUES, CENTER, 0.1)).toHaveLength(0);
  });
});
