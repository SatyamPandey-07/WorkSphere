/**
 * Tests for venue IoT sensor data processing.
 */

type SensorType = "temperature" | "humidity" | "co2" | "occupancy" | "noise";

interface SensorReading {
  sensorId: string;
  type: SensorType;
  value: number;
  timestamp: number;
  isOnline: boolean;
}

function latestReading(
  readings: SensorReading[],
  sensorId: string
): SensorReading | null {
  const sensorReadings = readings.filter((r) => r.sensorId === sensorId);
  if (sensorReadings.length === 0) return null;
  return sensorReadings.reduce((latest, r) =>
    r.timestamp > latest.timestamp ? r : latest
  );
}

function isAirQualityGood(readings: SensorReading[]): boolean {
  const co2 = readings.filter((r) => r.type === "co2" && r.isOnline);
  if (co2.length === 0) return true; // unknown = assume good
  return co2.every((r) => r.value < 1000); // ppm threshold
}

function offlineSensors(readings: SensorReading[]): string[] {
  return [...new Set(readings.filter((r) => !r.isOnline).map((r) => r.sensorId))];
}

function sensorAverage(readings: SensorReading[], type: SensorType): number {
  const typed = readings.filter((r) => r.type === type && r.isOnline);
  if (typed.length === 0) return 0;
  return typed.reduce((sum, r) => sum + r.value, 0) / typed.length;
}

const NOW = 1_700_000_000_000;
const READINGS: SensorReading[] = [
  { sensorId: "s1", type: "temperature", value: 22, timestamp: NOW - 1000, isOnline: true  },
  { sensorId: "s1", type: "temperature", value: 23, timestamp: NOW - 500,  isOnline: true  },
  { sensorId: "s2", type: "co2",         value: 800, timestamp: NOW - 2000, isOnline: true  },
  { sensorId: "s3", type: "noise",       value: 60,  timestamp: NOW - 1500, isOnline: false },
];

describe("Venue realtime sensor data", () => {
  it("latestReading: s1 most recent", () => {
    const latest = latestReading(READINGS, "s1");
    expect(latest!.value).toBe(23);
  });

  it("latestReading: unknown sensor → null", () => {
    expect(latestReading(READINGS, "s99")).toBeNull();
  });

  it("isAirQualityGood: CO2 at 800ppm → true", () => {
    expect(isAirQualityGood(READINGS)).toBe(true);
  });

  it("isAirQualityGood: CO2 over 1000ppm → false", () => {
    const highCo2 = [{ ...READINGS[2], value: 1200 }];
    expect(isAirQualityGood(highCo2)).toBe(false);
  });

  it("isAirQualityGood: no CO2 sensors → assume true", () => {
    expect(isAirQualityGood([READINGS[0]])).toBe(true);
  });

  it("offlineSensors: s3 is offline", () => {
    expect(offlineSensors(READINGS)).toContain("s3");
  });

  it("offlineSensors: no duplicates", () => {
    const offline = offlineSensors(READINGS);
    expect(new Set(offline).size).toBe(offline.length);
  });

  it("sensorAverage: temperature average (online only)", () => {
    expect(sensorAverage(READINGS, "temperature")).toBeCloseTo(22.5);
  });

  it("sensorAverage: noise (offline sensor excluded) → 0", () => {
    expect(sensorAverage(READINGS, "noise")).toBe(0);
  });
});
