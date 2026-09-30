/**
 * Tests for venue real-time noise monitoring and alert system.
 */

type NoiseAlertLevel = "info" | "warning" | "critical";

interface NoiseReading {
  sensorId: string;
  venueId: string;
  zoneId: string;
  decibels: number;
  timestamp: number;
}

interface NoiseThresholds {
  info: number;      // dB above which info alert triggers
  warning: number;
  critical: number;
}

const DEFAULT_THRESHOLDS: NoiseThresholds = {
  info: 55, warning: 70, critical: 85,
};

function classifyNoiseAlert(reading: NoiseReading, thresholds = DEFAULT_THRESHOLDS): NoiseAlertLevel | null {
  if (reading.decibels >= thresholds.critical) return "critical";
  if (reading.decibels >= thresholds.warning) return "warning";
  if (reading.decibels >= thresholds.info) return "info";
  return null;
}

function alertsForVenue(
  readings: NoiseReading[],
  venueId: string,
  nowMs: number,
  windowMs = 5 * 60_000
): { zone: string; level: NoiseAlertLevel; avgDb: number }[] {
  const recent = readings.filter(
    (r) => r.venueId === venueId && nowMs - r.timestamp <= windowMs
  );

  const byZone: Record<string, NoiseReading[]> = {};
  recent.forEach((r) => { (byZone[r.zoneId] = byZone[r.zoneId] ?? []).push(r); });

  return Object.entries(byZone)
    .map(([zone, zoneReadings]) => {
      const avgDb = Math.round(zoneReadings.reduce((s, r) => s + r.decibels, 0) / zoneReadings.length);
      const level = classifyNoiseAlert({ ...zoneReadings[0], decibels: avgDb });
      return level ? { zone, level, avgDb } : null;
    })
    .filter((a): a is { zone: string; level: NoiseAlertLevel; avgDb: number } => a !== null);
}

function quietestZone(readings: NoiseReading[], venueId: string): string | null {
  const byZone: Record<string, number[]> = {};
  readings.filter((r) => r.venueId === venueId).forEach((r) => {
    (byZone[r.zoneId] = byZone[r.zoneId] ?? []).push(r.decibels);
  });
  if (Object.keys(byZone).length === 0) return null;
  return Object.entries(byZone)
    .map(([z, dbs]) => ({ zone: z, avg: dbs.reduce((s, d) => s + d, 0) / dbs.length }))
    .reduce((min, z) => z.avg < min.avg ? z : min).zone;
}

const NOW = 1_700_000_000_000;
const READINGS: NoiseReading[] = [
  { sensorId: "s1", venueId: "v1", zoneId: "quiet",  decibels: 45, timestamp: NOW - 60_000  },
  { sensorId: "s2", venueId: "v1", zoneId: "social",  decibels: 75, timestamp: NOW - 30_000  },
  { sensorId: "s3", venueId: "v1", zoneId: "social",  decibels: 80, timestamp: NOW - 10_000  },
  { sensorId: "s4", venueId: "v2", zoneId: "main",   decibels: 90, timestamp: NOW - 5_000   },
];

describe("Venue noise monitor alert system", () => {
  it("classifyNoiseAlert: 90dB → critical", () => {
    expect(classifyNoiseAlert({ ...READINGS[0], decibels: 90 })).toBe("critical");
  });

  it("classifyNoiseAlert: 72dB → warning", () => {
    expect(classifyNoiseAlert({ ...READINGS[0], decibels: 72 })).toBe("warning");
  });

  it("classifyNoiseAlert: 40dB → null (below info threshold)", () => {
    expect(classifyNoiseAlert({ ...READINGS[0], decibels: 40 })).toBeNull();
  });

  it("alertsForVenue: v1 social zone has warning/critical", () => {
    const alerts = alertsForVenue(READINGS, "v1", NOW);
    const socialAlert = alerts.find((a) => a.zone === "social");
    expect(socialAlert).not.toBeUndefined();
    expect(["warning", "critical"]).toContain(socialAlert!.level);
  });

  it("alertsForVenue: quiet zone no alert (45dB)", () => {
    const alerts = alertsForVenue(READINGS, "v1", NOW);
    expect(alerts.find((a) => a.zone === "quiet")).toBeUndefined();
  });

  it("quietestZone: v1 quiet zone = quietest", () => {
    expect(quietestZone(READINGS, "v1")).toBe("quiet");
  });

  it("quietestZone: no readings → null", () => {
    expect(quietestZone([], "v1")).toBeNull();
  });
});
