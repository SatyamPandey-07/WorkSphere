/**
 * Tests for user location history tracking for venue recommendations.
 */

interface LocationRecord {
  userId: string;
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number; // meters
  source: "gps" | "wifi" | "cell";
}

function recentLocations(
  records: LocationRecord[],
  userId: string,
  windowMs: number,
  nowMs: number
): LocationRecord[] {
  return records
    .filter((r) => r.userId === userId && nowMs - r.timestamp <= windowMs)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function latestLocation(
  records: LocationRecord[],
  userId: string
): LocationRecord | null {
  const user = records.filter((r) => r.userId === userId);
  if (user.length === 0) return null;
  return user.reduce((latest, r) => r.timestamp > latest.timestamp ? r : latest);
}

function approximateCenter(records: LocationRecord[]): { lat: number; lng: number } | null {
  if (records.length === 0) return null;
  const accurateRecords = records.filter((r) => r.accuracy <= 50); // 50m accuracy threshold
  const source = accurateRecords.length > 0 ? accurateRecords : records;
  return {
    lat: Math.round((source.reduce((s, r) => s + r.lat, 0) / source.length) * 10000) / 10000,
    lng: Math.round((source.reduce((s, r) => s + r.lng, 0) / source.length) * 10000) / 10000,
  };
}

function isNearVenue(
  record: LocationRecord,
  venueLat: number,
  venueLng: number,
  radiusMeters: number
): boolean {
  const R = 6_371_000;
  const dLat = ((venueLat - record.lat) * Math.PI) / 180;
  const dLng = ((venueLng - record.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((record.lat * Math.PI) / 180) * Math.cos((venueLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return dist <= radiusMeters;
}

const NOW = 1_700_000_000_000;
const RECORDS: LocationRecord[] = [
  { userId: "u1", lat: 40.712, lng: -74.006, timestamp: NOW - 60_000,  accuracy: 20,  source: "gps" },
  { userId: "u1", lat: 40.713, lng: -74.007, timestamp: NOW - 120_000, accuracy: 100, source: "cell" },
  { userId: "u2", lat: 51.505, lng: -0.09,   timestamp: NOW - 10_000,  accuracy: 10,  source: "gps"  },
];

describe("User location history tracking", () => {
  it("latestLocation: u1 most recent", () => {
    expect(latestLocation(RECORDS, "u1")!.timestamp).toBe(NOW - 60_000);
  });

  it("latestLocation: unknown user → null", () => {
    expect(latestLocation(RECORDS, "u99")).toBeNull();
  });

  it("recentLocations: u1 in last 90s", () => {
    const recent = recentLocations(RECORDS, "u1", 90_000, NOW);
    expect(recent).toHaveLength(1);
  });

  it("approximateCenter: uses accurate records only", () => {
    const center = approximateCenter(RECORDS.slice(0, 2))!;
    // Should prefer accurate record (u1 first)
    expect(center.lat).toBeCloseTo(40.712, 2);
  });

  it("approximateCenter: empty → null", () => {
    expect(approximateCenter([])).toBeNull();
  });

  it("isNearVenue: same location → true", () => {
    expect(isNearVenue(RECORDS[0], 40.712, -74.006, 100)).toBe(true);
  });

  it("isNearVenue: London → not near NYC", () => {
    expect(isNearVenue(RECORDS[2], 40.712, -74.006, 500)).toBe(false);
  });
});
