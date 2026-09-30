/**
 * Tests for geolocation-based venue check-in validation.
 */

interface GeolocationCheckin {
  checkInId: string;
  bookingId: string;
  userId: string;
  venueId: string;
  venueLat: number;
  venueLng: number;
  userLat: number;
  userLng: number;
  accuracyMeters: number;
  timestamp: number;
}

function haversineDistanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinCheckInRadius(
  checkin: GeolocationCheckin,
  radiusMeters: number
): boolean {
  const distance = haversineDistanceMeters(
    checkin.userLat, checkin.userLng,
    checkin.venueLat, checkin.venueLng
  );
  const effectiveRadius = radiusMeters + checkin.accuracyMeters;
  return distance <= effectiveRadius;
}

function checkInConfidence(checkin: GeolocationCheckin, radiusMeters: number): number {
  const distance = haversineDistanceMeters(
    checkin.userLat, checkin.userLng,
    checkin.venueLat, checkin.venueLng
  );
  if (distance <= radiusMeters) return 1.0;
  const combined = radiusMeters + checkin.accuracyMeters;
  if (distance > combined) return 0.0;
  return Math.round((1 - (distance - radiusMeters) / checkin.accuracyMeters) * 100) / 100;
}

function validateCheckin(
  checkin: GeolocationCheckin,
  bookingStartMs: number,
  allowedWindowMs: number = 30 * 60_000,
  radiusMeters: number = 200
): { valid: boolean; reason?: string } {
  const timeDeviation = Math.abs(checkin.timestamp - bookingStartMs);
  if (timeDeviation > allowedWindowMs) {
    return { valid: false, reason: "Check-in outside time window" };
  }
  if (!isWithinCheckInRadius(checkin, radiusMeters)) {
    return { valid: false, reason: "Too far from venue" };
  }
  return { valid: true };
}

const NOW = 1_700_000_000_000;
const CHECKIN_NEAR: GeolocationCheckin = {
  checkInId: "ci1", bookingId: "b1", userId: "u1", venueId: "v1",
  venueLat: 40.7128, venueLng: -74.0060,
  userLat: 40.7129, userLng: -74.0061, // very close
  accuracyMeters: 10, timestamp: NOW,
};

const CHECKIN_FAR: GeolocationCheckin = {
  ...CHECKIN_NEAR, checkInId: "ci2",
  userLat: 40.800, userLng: -74.100, // far away
};

describe("Geolocation check-in validation", () => {
  it("isWithinCheckInRadius: nearby → true", () => {
    expect(isWithinCheckInRadius(CHECKIN_NEAR, 200)).toBe(true);
  });

  it("isWithinCheckInRadius: far → false", () => {
    expect(isWithinCheckInRadius(CHECKIN_FAR, 200)).toBe(false);
  });

  it("checkInConfidence: near = 1.0", () => {
    expect(checkInConfidence(CHECKIN_NEAR, 200)).toBe(1.0);
  });

  it("checkInConfidence: far = 0.0", () => {
    expect(checkInConfidence(CHECKIN_FAR, 200)).toBe(0.0);
  });

  it("validateCheckin: valid near check-in → valid", () => {
    const { valid } = validateCheckin(CHECKIN_NEAR, NOW);
    expect(valid).toBe(true);
  });

  it("validateCheckin: too far → invalid", () => {
    const { valid, reason } = validateCheckin(CHECKIN_FAR, NOW);
    expect(valid).toBe(false);
    expect(reason).toContain("Too far");
  });

  it("validateCheckin: outside time window → invalid", () => {
    const lateCheckin = { ...CHECKIN_NEAR, timestamp: NOW + 2 * 3600_000 };
    const { valid, reason } = validateCheckin(lateCheckin, NOW);
    expect(valid).toBe(false);
    expect(reason).toContain("time window");
  });
});
