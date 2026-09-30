/**
 * Tests for proximity-based venue notification triggering.
 */

interface VenueProximityRule {
  venueId: string;
  userId: string;
  triggerRadiusMeters: number;
  notificationMessage: string;
  enabled: boolean;
  cooldownMs: number;
  lastTriggeredAt: number | null;
}

interface UserLocation {
  userId: string;
  lat: number;
  lng: number;
  timestampMs: number;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shouldTriggerNotification(
  rule: VenueProximityRule,
  userLat: number,
  userLng: number,
  venueLat: number,
  venueLng: number,
  nowMs: number
): boolean {
  if (!rule.enabled) return false;
  if (rule.lastTriggeredAt !== null && nowMs - rule.lastTriggeredAt < rule.cooldownMs) return false;
  return distanceMeters(userLat, userLng, venueLat, venueLng) <= rule.triggerRadiusMeters;
}

function markTriggered(rule: VenueProximityRule, nowMs: number): VenueProximityRule {
  return { ...rule, lastTriggeredAt: nowMs };
}

const NOW = 1_700_000_000_000;
const RULE: VenueProximityRule = {
  venueId: "v1", userId: "u1",
  triggerRadiusMeters: 200,
  notificationMessage: "Coffee Hub is 200m away!",
  enabled: true,
  cooldownMs: 3_600_000, lastTriggeredAt: null,
};

const VENUE_LAT = 40.7128;
const VENUE_LNG = -74.006;

describe("Venue proximity notifications", () => {
  it("shouldTriggerNotification: within radius → true", () => {
    // User at same location as venue
    expect(shouldTriggerNotification(RULE, VENUE_LAT, VENUE_LNG, VENUE_LAT, VENUE_LNG, NOW)).toBe(true);
  });

  it("shouldTriggerNotification: too far → false", () => {
    expect(shouldTriggerNotification(RULE, 41.0, -74.0, VENUE_LAT, VENUE_LNG, NOW)).toBe(false);
  });

  it("shouldTriggerNotification: disabled → false", () => {
    expect(shouldTriggerNotification({ ...RULE, enabled: false }, VENUE_LAT, VENUE_LNG, VENUE_LAT, VENUE_LNG, NOW)).toBe(false);
  });

  it("shouldTriggerNotification: within cooldown → false", () => {
    const recent = { ...RULE, lastTriggeredAt: NOW - 1000 };
    expect(shouldTriggerNotification(recent, VENUE_LAT, VENUE_LNG, VENUE_LAT, VENUE_LNG, NOW)).toBe(false);
  });

  it("shouldTriggerNotification: cooldown expired → true", () => {
    const old = { ...RULE, lastTriggeredAt: NOW - 4_000_000 };
    expect(shouldTriggerNotification(old, VENUE_LAT, VENUE_LNG, VENUE_LAT, VENUE_LNG, NOW)).toBe(true);
  });

  it("markTriggered: sets lastTriggeredAt", () => {
    expect(markTriggered(RULE, NOW).lastTriggeredAt).toBe(NOW);
  });

  it("markTriggered is immutable", () => {
    markTriggered(RULE, NOW);
    expect(RULE.lastTriggeredAt).toBeNull();
  });
});
