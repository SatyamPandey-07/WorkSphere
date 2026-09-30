/**
 * Tests for venue noise level and compliance monitoring.
 */

interface NoiseReading {
  timestamp: number;
  decibels: number;
  zone: string;
}

interface NoisePolicy {
  venueId: string;
  maxDecibels: number;
  warningDecibels: number;
  curfewStart: number; // hour 0-23
  curfewEnd: number;   // hour 0-23
}

function noiseStatus(reading: NoiseReading, policy: NoisePolicy): "ok" | "warning" | "violation" {
  if (reading.decibels > policy.maxDecibels) return "violation";
  if (reading.decibels >= policy.warningDecibels) return "warning";
  return "ok";
}

function isCurfewHour(timestampMs: number, policy: NoisePolicy): boolean {
  const hour = new Date(timestampMs).getUTCHours();
  if (policy.curfewStart <= policy.curfewEnd) {
    return hour >= policy.curfewStart && hour < policy.curfewEnd;
  }
  // wraps midnight
  return hour >= policy.curfewStart || hour < policy.curfewEnd;
}

function avgDecibels(readings: NoiseReading[]): number {
  if (readings.length === 0) return 0;
  return Math.round(readings.reduce((s, r) => s + r.decibels, 0) / readings.length);
}

function peakReading(readings: NoiseReading[]): NoiseReading | null {
  if (readings.length === 0) return null;
  return readings.reduce((max, r) => (r.decibels > max.decibels ? r : max), readings[0]);
}

function violationCount(readings: NoiseReading[], policy: NoisePolicy): number {
  return readings.filter((r) => noiseStatus(r, policy) === "violation").length;
}

const POLICY: NoisePolicy = {
  venueId: "v1", maxDecibels: 90, warningDecibels: 80, curfewStart: 22, curfewEnd: 7,
};
const READINGS: NoiseReading[] = [
  { timestamp: 1_700_000_000_000, decibels: 75, zone: "main" },
  { timestamp: 1_700_000_000_001, decibels: 85, zone: "main" },
  { timestamp: 1_700_000_000_002, decibels: 95, zone: "main" },
];

describe("Venue noise compliance monitoring", () => {
  it("noiseStatus: 75 dB → ok", () => {
    expect(noiseStatus(READINGS[0], POLICY)).toBe("ok");
  });

  it("noiseStatus: 85 dB → warning", () => {
    expect(noiseStatus(READINGS[1], POLICY)).toBe("warning");
  });

  it("noiseStatus: 95 dB → violation", () => {
    expect(noiseStatus(READINGS[2], POLICY)).toBe("violation");
  });

  it("avgDecibels: average of readings", () => {
    expect(avgDecibels(READINGS)).toBe(85);
  });

  it("peakReading: 95 dB", () => {
    expect(peakReading(READINGS)?.decibels).toBe(95);
  });

  it("violationCount: 1 violation", () => {
    expect(violationCount(READINGS, POLICY)).toBe(1);
  });

  it("peakReading: null for empty", () => {
    expect(peakReading([])).toBeNull();
  });
});
