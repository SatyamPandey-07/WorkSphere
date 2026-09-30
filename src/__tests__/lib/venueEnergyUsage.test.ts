/**
 * Tests for venue energy usage monitoring and efficiency rating.
 */

type EnergyRating = "A+" | "A" | "B" | "C" | "D" | "E";

interface EnergyReading {
  timestamp: number;
  kwhConsumed: number;
  occupancy: number; // number of people
}

function kwhPerPerson(reading: EnergyReading): number {
  if (reading.occupancy === 0) return 0;
  return reading.kwhConsumed / reading.occupancy;
}

function averageKwhPerPerson(readings: EnergyReading[]): number {
  const withOccupancy = readings.filter((r) => r.occupancy > 0);
  if (withOccupancy.length === 0) return 0;
  const total = withOccupancy.reduce((s, r) => s + kwhPerPerson(r), 0);
  return total / withOccupancy.length;
}

function energyRating(kwhPerPersonPerHour: number): EnergyRating {
  if (kwhPerPersonPerHour <= 0.1) return "A+";
  if (kwhPerPersonPerHour <= 0.3) return "A";
  if (kwhPerPersonPerHour <= 0.6) return "B";
  if (kwhPerPersonPerHour <= 1.0) return "C";
  if (kwhPerPersonPerHour <= 2.0) return "D";
  return "E";
}

function totalKwh(readings: EnergyReading[]): number {
  return readings.reduce((s, r) => s + r.kwhConsumed, 0);
}

const READINGS: EnergyReading[] = [
  { timestamp: 1_700_000_000_000, kwhConsumed: 5,  occupancy: 20 }, // 0.25 kWh/person
  { timestamp: 1_700_000_003_600, kwhConsumed: 8,  occupancy: 25 }, // 0.32
  { timestamp: 1_700_000_007_200, kwhConsumed: 10, occupancy: 0  }, // no occupancy
];

describe("Venue energy usage", () => {
  it("kwhPerPerson: 5kWh / 20 people = 0.25", () => {
    expect(kwhPerPerson(READINGS[0])).toBe(0.25);
  });

  it("kwhPerPerson: 0 occupancy → 0", () => {
    expect(kwhPerPerson(READINGS[2])).toBe(0);
  });

  it("averageKwhPerPerson excludes zero-occupancy", () => {
    // (0.25 + 0.32) / 2 = 0.285
    expect(averageKwhPerPerson(READINGS)).toBeCloseTo(0.285);
  });

  it("averageKwhPerPerson: all zero occupancy → 0", () => {
    expect(averageKwhPerPerson([READINGS[2]])).toBe(0);
  });

  it("energyRating: 0.05 kWh/person → A+", () => {
    expect(energyRating(0.05)).toBe("A+");
  });

  it("energyRating: 0.25 → A", () => {
    expect(energyRating(0.25)).toBe("A");
  });

  it("energyRating: 0.5 → B", () => {
    expect(energyRating(0.5)).toBe("B");
  });

  it("energyRating: 3.0 → E", () => {
    expect(energyRating(3.0)).toBe("E");
  });

  it("totalKwh sums all readings", () => {
    expect(totalKwh(READINGS)).toBe(23);
  });
});
