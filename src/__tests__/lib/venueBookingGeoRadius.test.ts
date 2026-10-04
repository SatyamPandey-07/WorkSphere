/**
 * Tests for venue geo-radius search and distance-based filtering.
 */

interface GeoPoint {
  lat: number;
  lng: number;
}

interface GeoVenue {
  id: string;
  name: string;
  location: GeoPoint;
  city: string;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number { return (deg * Math.PI) / 180; }

function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const chord = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord)) * 100) / 100;
}

function venuesWithinRadius(
  center: GeoPoint,
  venues: GeoVenue[],
  radiusKm: number
): GeoVenue[] {
  return venues.filter((v) => distanceKm(center, v.location) <= radiusKm);
}

function nearestN(center: GeoPoint, venues: GeoVenue[], n: number): GeoVenue[] {
  return [...venues]
    .sort((a, b) => distanceKm(center, a.location) - distanceKm(center, b.location))
    .slice(0, n);
}

function bboxFilter(
  venues: GeoVenue[],
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): GeoVenue[] {
  return venues.filter(
    (v) =>
      v.location.lat >= minLat && v.location.lat <= maxLat &&
      v.location.lng >= minLng && v.location.lng <= maxLng
  );
}

// London coordinates
const CENTRAL_LONDON: GeoPoint = { lat: 51.5074, lng: -0.1278 };
const VENUES: GeoVenue[] = [
  { id: "v1", name: "Canary Wharf Events", location: { lat: 51.5047, lng: -0.0218 }, city: "London" },
  { id: "v2", name: "Westminster Hall",    location: { lat: 51.5007, lng: -0.1246 }, city: "London" },
  { id: "v3", name: "Manchester Arena",    location: { lat: 53.4808, lng: -2.2426 }, city: "Manchester" },
];

describe("Geo-radius search", () => {
  it("distanceKm: same point → 0", () => {
    expect(distanceKm(CENTRAL_LONDON, CENTRAL_LONDON)).toBe(0);
  });

  it("distanceKm: Westminster ~0.7km from center", () => {
    const d = distanceKm(CENTRAL_LONDON, VENUES[1].location);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(2);
  });

  it("venuesWithinRadius: 5km from center includes v1 and v2", () => {
    const nearby = venuesWithinRadius(CENTRAL_LONDON, VENUES, 5);
    const ids = nearby.map((v) => v.id);
    expect(ids).toContain("v1");
    expect(ids).toContain("v2");
    expect(ids).not.toContain("v3");
  });

  it("nearestN: nearest 1 is Westminster", () => {
    const nearest = nearestN(CENTRAL_LONDON, VENUES, 1);
    expect(nearest[0].id).toBe("v2");
  });

  it("bboxFilter: London bounding box excludes Manchester", () => {
    const london = bboxFilter(VENUES, 51.4, 51.6, -0.3, 0.1);
    expect(london.map((v) => v.id)).not.toContain("v3");
  });
});
