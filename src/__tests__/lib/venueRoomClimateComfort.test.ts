/**
 * Tests for venue room climate comfort index calculation.
 */

interface ClimateReading {
  roomId: string;
  venueId: string;
  tempCelsius: number;
  humidity: number;       // 0-100%
  co2Ppm: number;
  vocIndex: number;       // 0-500
  pm25: number;           // µg/m³
  timestamp: number;
}

function apparentTemperature(temp: number, humidity: number): number {
  // Heat index formula (simplified)
  if (temp < 27) return temp; // Below 27°C, humidity has minimal effect
  const hi = -8.78469475556 + 1.61139411 * temp + 2.33854883889 * humidity
    - 0.14611605 * temp * humidity - 0.012308094 * temp ** 2
    - 0.0164248277778 * humidity ** 2 + 0.002211732 * temp ** 2 * humidity
    + 0.00072546 * temp * humidity ** 2 - 0.000003582 * temp ** 2 * humidity ** 2;
  return Math.round(hi * 10) / 10;
}

function climateComfortScore(reading: ClimateReading): number {
  let score = 100;

  // Temperature penalty
  if (reading.tempCelsius < 18 || reading.tempCelsius > 26) {
    score -= Math.abs(reading.tempCelsius - 22) * 3;
  }

  // Humidity penalty
  if (reading.humidity < 30 || reading.humidity > 60) {
    score -= Math.abs(reading.humidity - 45) * 0.5;
  }

  // Air quality
  if (reading.co2Ppm > 800) score -= (reading.co2Ppm - 800) / 100;
  if (reading.vocIndex > 150) score -= (reading.vocIndex - 150) / 50;
  if (reading.pm25 > 12) score -= (reading.pm25 - 12) * 2;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function isComfortableForWork(reading: ClimateReading): boolean {
  return (
    reading.tempCelsius >= 18 && reading.tempCelsius <= 26 &&
    reading.humidity >= 30 && reading.humidity <= 60 &&
    reading.co2Ppm < 1000 &&
    reading.pm25 < 25
  );
}

function roomsNeedingAttention(
  readings: ClimateReading[],
  venueId: string,
  minScore = 70
): string[] {
  return readings
    .filter((r) => r.venueId === venueId && climateComfortScore(r) < minScore)
    .map((r) => r.roomId);
}

const NOW = 1_700_000_000_000;
const GOOD_READING: ClimateReading = { roomId: "r1", venueId: "v1", tempCelsius: 22, humidity: 45, co2Ppm: 600, vocIndex: 50, pm25: 5, timestamp: NOW };
const POOR_READING: ClimateReading = { roomId: "r2", venueId: "v1", tempCelsius: 30, humidity: 75, co2Ppm: 1500, vocIndex: 300, pm25: 30, timestamp: NOW };

describe("Venue room climate comfort", () => {
  it("climateComfortScore: ideal conditions → 100", () => {
    expect(climateComfortScore(GOOD_READING)).toBe(100);
  });

  it("climateComfortScore: poor conditions → low score", () => {
    expect(climateComfortScore(POOR_READING)).toBeLessThan(50);
  });

  it("isComfortableForWork: good reading → true", () => {
    expect(isComfortableForWork(GOOD_READING)).toBe(true);
  });

  it("isComfortableForWork: high temp/humidity → false", () => {
    expect(isComfortableForWork(POOR_READING)).toBe(false);
  });

  it("roomsNeedingAttention: r2 below threshold", () => {
    const rooms = roomsNeedingAttention([GOOD_READING, POOR_READING], "v1");
    expect(rooms).toContain("r2");
    expect(rooms).not.toContain("r1");
  });

  it("apparentTemperature: below 27°C unchanged", () => {
    expect(apparentTemperature(22, 50)).toBe(22);
  });
});
