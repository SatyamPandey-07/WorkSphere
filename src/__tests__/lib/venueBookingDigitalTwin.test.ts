/**
 * Tests for venue digital twin state synchronization.
 */

interface SensorReading {
  sensorId: string;
  type: "temperature" | "humidity" | "co2" | "occupancy" | "light";
  value: number;
  unit: string;
  timestamp: number;
  isCalibrated: boolean;
}

interface DigitalTwinState {
  venueId: string;
  lastSync: number;
  sensors: Map<string, SensorReading>;
  alerts: string[];
}

interface EnvironmentThresholds {
  temperatureMin: number;
  temperatureMax: number;
  humidityMin: number;
  humidityMax: number;
  co2Max: number;
}

const DEFAULT_THRESHOLDS: EnvironmentThresholds = {
  temperatureMin: 18, temperatureMax: 26,
  humidityMin: 30, humidityMax: 70,
  co2Max: 1000,
};

function checkSensorAlert(reading: SensorReading, thresholds: EnvironmentThresholds): string | null {
  switch (reading.type) {
    case "temperature":
      if (reading.value < thresholds.temperatureMin) return `Low temperature: ${reading.value}°C`;
      if (reading.value > thresholds.temperatureMax) return `High temperature: ${reading.value}°C`;
      break;
    case "humidity":
      if (reading.value < thresholds.humidityMin) return `Low humidity: ${reading.value}%`;
      if (reading.value > thresholds.humidityMax) return `High humidity: ${reading.value}%`;
      break;
    case "co2":
      if (reading.value > thresholds.co2Max) return `High CO2: ${reading.value}ppm`;
      break;
  }
  return null;
}

function isSyncStale(state: DigitalTwinState, nowMs: number, maxAgeMs = 60_000): boolean {
  return nowMs - state.lastSync > maxAgeMs;
}

function latestReading(
  sensors: SensorReading[],
  type: SensorReading["type"]
): SensorReading | null {
  const typed = sensors.filter((s) => s.type === type);
  if (typed.length === 0) return null;
  return typed.reduce((latest, s) => (s.timestamp > latest.timestamp ? s : latest), typed[0]);
}

function calibratedReadings(sensors: SensorReading[]): SensorReading[] {
  return sensors.filter((s) => s.isCalibrated);
}

const NOW = 1_700_000_000_000;
const SENSORS: SensorReading[] = [
  { sensorId: "s1", type: "temperature", value: 22,   unit: "°C",  timestamp: NOW - 10_000, isCalibrated: true },
  { sensorId: "s2", type: "temperature", value: 29,   unit: "°C",  timestamp: NOW - 5_000,  isCalibrated: true },
  { sensorId: "s3", type: "co2",         value: 1200, unit: "ppm", timestamp: NOW - 8_000,  isCalibrated: false },
  { sensorId: "s4", type: "humidity",    value: 45,   unit: "%",   timestamp: NOW - 2_000,  isCalibrated: true },
];

describe("Digital twin state management", () => {
  it("checkSensorAlert: 29°C above max → alert", () => {
    const alert = checkSensorAlert(SENSORS[1], DEFAULT_THRESHOLDS);
    expect(alert).toContain("High temperature");
  });

  it("checkSensorAlert: 22°C in range → null", () => {
    expect(checkSensorAlert(SENSORS[0], DEFAULT_THRESHOLDS)).toBeNull();
  });

  it("checkSensorAlert: CO2 1200ppm → alert", () => {
    const alert = checkSensorAlert(SENSORS[2], DEFAULT_THRESHOLDS);
    expect(alert).toContain("High CO2");
  });

  it("latestReading: most recent temperature sensor", () => {
    expect(latestReading(SENSORS, "temperature")?.sensorId).toBe("s2");
  });

  it("calibratedReadings: 3 calibrated sensors", () => {
    expect(calibratedReadings(SENSORS).length).toBe(3);
  });

  it("isSyncStale: last sync 2 minutes ago → stale", () => {
    const state: DigitalTwinState = {
      venueId: "v1", lastSync: NOW - 120_000, sensors: new Map(), alerts: [],
    };
    expect(isSyncStale(state, NOW)).toBe(true);
  });
});
