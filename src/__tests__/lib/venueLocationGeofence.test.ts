/**
 * Tests for venue geofence radius and location proximity.
 */

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinGeofence(
  userLat: number, userLng: number,
  venueLat: number, venueLng: number,
  radiusMeters: number,
): boolean {
  return distanceKm(userLat, userLng, venueLat, venueLng) * 1000 <= radiusMeters;
}

describe("Venue geofence proximity", () => {
  const VENUE = { lat: 40.7128, lng: -74.006 };

  it("user at exact venue location is within 50m geofence", () => {
    expect(isWithinGeofence(VENUE.lat, VENUE.lng, VENUE.lat, VENUE.lng, 50)).toBe(true);
  });

  it("user very close (0.001° ≈ 111m) may or may not be within 50m", () => {
    const dist = distanceKm(VENUE.lat, VENUE.lng, VENUE.lat + 0.001, VENUE.lng) * 1000;
    expect(dist).toBeGreaterThan(0);
  });

  it("user 1km away is not within 100m geofence", () => {
    expect(isWithinGeofence(VENUE.lat + 0.01, VENUE.lng, VENUE.lat, VENUE.lng, 100)).toBe(false);
  });

  it("distance is always non-negative", () => {
    expect(distanceKm(40.0, -74.0, 41.0, -73.0)).toBeGreaterThanOrEqual(0);
  });

  it("distance from A to B equals distance from B to A (symmetric)", () => {
    const d1 = distanceKm(40.7, -74.0, 51.5, -0.1);
    const d2 = distanceKm(51.5, -0.1, 40.7, -74.0);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });

  it("large geofence (1km) includes user nearby", () => {
    expect(isWithinGeofence(VENUE.lat + 0.005, VENUE.lng, VENUE.lat, VENUE.lng, 1000)).toBe(true);
  });
});
