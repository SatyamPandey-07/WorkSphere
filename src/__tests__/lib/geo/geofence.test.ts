import {
  calculateDistanceMeters,
  GEOFENCE_RADIUS_METERS,
  isOutsideGeofence,
  type Coordinates,
} from "@/lib/geo/geofence";

describe("Geofence utility", () => {
  const venue: Coordinates = { latitude: 37.7749, longitude: -122.4194 };

  it("uses the configured 250 meter radius", () => {
    expect(GEOFENCE_RADIUS_METERS).toBe(250);
  });

  it("detects coordinates inside the configured radius", () => {
    const user: Coordinates = { latitude: 37.7752, longitude: -122.4194 };
    expect(isOutsideGeofence(user, venue)).toBe(false);
  });

  it("detects coordinates outside the configured radius", () => {
    const user: Coordinates = { latitude: 37.7794, longitude: -122.4194 };
    expect(isOutsideGeofence(user, venue)).toBe(true);
  });

  it("treats the exact boundary as inside", () => {
    const user: Coordinates = { latitude: 37.7752, longitude: -122.4194 };
    const exactDistance = calculateDistanceMeters(user, venue);
    expect(isOutsideGeofence(user, venue, exactDistance)).toBe(false);
  });

  it("returns a finite distance for valid coordinates", () => {
    expect(calculateDistanceMeters(venue, { ...venue })).toBe(0);
  });

  it("handles invalid and missing coordinates safely", () => {
    expect(Number.isFinite(calculateDistanceMeters(venue, { latitude: NaN, longitude: 0 }))).toBe(false);
  });
});
