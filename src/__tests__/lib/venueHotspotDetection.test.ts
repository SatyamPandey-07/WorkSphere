/**
 * Tests for venue activity hotspot detection from check-in data.
 */

interface CheckinDataPoint {
  userId: string;
  venueId: string;
  lat: number;
  lng: number;
  timestamp: number;
  zoneId: string;
}

interface Hotspot {
  zoneId: string;
  lat: number;
  lng: number;
  intensity: number;  // check-ins per hour
  timeOfDay: "morning" | "afternoon" | "evening";
}

function detectHotspots(
  data: CheckinDataPoint[],
  venueId: string,
  windowMs: number,
  nowMs: number
): Record<string, number> {
  const recent = data.filter((d) => d.venueId === venueId && nowMs - d.timestamp <= windowMs);
  const counts: Record<string, number> = {};
  recent.forEach((d) => { counts[d.zoneId] = (counts[d.zoneId] ?? 0) + 1; });
  return counts;
}

function intensityScore(checkins: number, windowHours: number): number {
  if (windowHours <= 0) return 0;
  return Math.round((checkins / windowHours) * 10) / 10;
}

function peakZone(data: CheckinDataPoint[], venueId: string, windowMs: number, nowMs: number): string | null {
  const hotspots = detectHotspots(data, venueId, windowMs, nowMs);
  const entries = Object.entries(hotspots);
  if (entries.length === 0) return null;
  return entries.reduce((max, e) => Number(e[1]) > Number(max[1]) ? e : max)[0];
}

function timeOfDayLabel(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function hotspotTrend(
  recent: Record<string, number>,
  previous: Record<string, number>
): Record<string, "increasing" | "stable" | "decreasing"> {
  const trends: Record<string, "increasing" | "stable" | "decreasing"> = {};
  const allZones = new Set([...Object.keys(recent), ...Object.keys(previous)]);
  allZones.forEach((zone) => {
    const r = recent[zone] ?? 0;
    const p = previous[zone] ?? 0;
    if (r > p * 1.2) trends[zone] = "increasing";
    else if (r < p * 0.8) trends[zone] = "decreasing";
    else trends[zone] = "stable";
  });
  return trends;
}

const NOW = 1_700_000_000_000;
const DATA: CheckinDataPoint[] = [
  { userId: "u1", venueId: "v1", lat: 40.712, lng: -74.006, timestamp: NOW - 1000,    zoneId: "z1" },
  { userId: "u2", venueId: "v1", lat: 40.712, lng: -74.006, timestamp: NOW - 2000,    zoneId: "z1" },
  { userId: "u3", venueId: "v1", lat: 40.712, lng: -74.007, timestamp: NOW - 3000,    zoneId: "z2" },
  { userId: "u4", venueId: "v1", lat: 40.712, lng: -74.006, timestamp: NOW - 90_000_000, zoneId: "z1" }, // old
];

describe("Venue activity hotspot detection", () => {
  it("detectHotspots: z1 has 2 recent check-ins", () => {
    const hotspots = detectHotspots(DATA, "v1", 3_600_000, NOW);
    expect(hotspots.z1).toBe(2);
  });

  it("detectHotspots: old check-in excluded", () => {
    const hotspots = detectHotspots(DATA, "v1", 3_600_000, NOW);
    const total = Object.values(hotspots).reduce((s, v) => s + v, 0);
    expect(total).toBe(3); // only recent 3
  });

  it("peakZone: z1 is peak (2 checkins > 1)", () => {
    expect(peakZone(DATA, "v1", 3_600_000, NOW)).toBe("z1");
  });

  it("intensityScore: 10 checkins in 2h = 5.0", () => {
    expect(intensityScore(10, 2)).toBe(5);
  });

  it("timeOfDayLabel: hour 9 → morning", () => {
    expect(timeOfDayLabel(9)).toBe("morning");
  });

  it("hotspotTrend: z1 doubled → increasing", () => {
    const recent = { z1: 10, z2: 5 };
    const previous = { z1: 4, z2: 5 };
    const trend = hotspotTrend(recent, previous);
    expect(trend.z1).toBe("increasing");
    expect(trend.z2).toBe("stable");
  });
});
