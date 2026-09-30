/**
 * Tests for venue energy management and sustainability metrics.
 */

interface EnergyReading {
  timestamp: number;
  kWh: number;
  source: "grid" | "solar" | "battery";
  zone: string;
}

interface EnergyBudget {
  venueId: string;
  dailyKwhLimit: number;
  costPerKwh: number;
  renewableTarget: number; // 0-1 fraction
}

function totalKwh(readings: EnergyReading[]): number {
  return Math.round(readings.reduce((s, r) => s + r.kWh, 0) * 100) / 100;
}

function renewableFraction(readings: EnergyReading[]): number {
  const total = totalKwh(readings);
  if (total === 0) return 0;
  const renewable = readings
    .filter((r) => r.source === "solar" || r.source === "battery")
    .reduce((s, r) => s + r.kWh, 0);
  return Math.round((renewable / total) * 100) / 100;
}

function energyCost(readings: EnergyReading[], costPerKwh: number): number {
  return Math.round(totalKwh(readings) * costPerKwh * 100) / 100;
}

function isOverBudget(readings: EnergyReading[], budget: EnergyBudget): boolean {
  return totalKwh(readings) > budget.dailyKwhLimit;
}

function renewableShortfall(readings: EnergyReading[], budget: EnergyBudget): number {
  const actual = renewableFraction(readings);
  return Math.max(0, Math.round((budget.renewableTarget - actual) * 100) / 100);
}

function peakConsumptionZone(readings: EnergyReading[]): string | null {
  if (readings.length === 0) return null;
  const byZone: Record<string, number> = {};
  for (const r of readings) {
    byZone[r.zone] = (byZone[r.zone] ?? 0) + r.kWh;
  }
  return Object.entries(byZone).sort((a, b) => b[1] - a[1])[0][0];
}

const BUDGET: EnergyBudget = { venueId: "v1", dailyKwhLimit: 100, costPerKwh: 0.15, renewableTarget: 0.4 };
const READINGS: EnergyReading[] = [
  { timestamp: 1_700_000_000_000, kWh: 40, source: "grid",    zone: "main" },
  { timestamp: 1_700_000_003_600, kWh: 25, source: "solar",   zone: "main" },
  { timestamp: 1_700_000_007_200, kWh: 15, source: "battery", zone: "kitchen" },
  { timestamp: 1_700_000_010_800, kWh: 20, source: "grid",    zone: "kitchen" },
];

describe("Venue energy management", () => {
  it("totalKwh: sum of all readings = 100", () => {
    expect(totalKwh(READINGS)).toBe(100);
  });

  it("renewableFraction: 40% renewable", () => {
    expect(renewableFraction(READINGS)).toBe(0.4);
  });

  it("energyCost: 100 kWh at $0.15 = $15", () => {
    expect(energyCost(READINGS, 0.15)).toBe(15);
  });

  it("isOverBudget: exactly at limit → false", () => {
    expect(isOverBudget(READINGS, BUDGET)).toBe(false);
  });

  it("renewableShortfall: target met → 0", () => {
    expect(renewableShortfall(READINGS, BUDGET)).toBe(0);
  });

  it("peakConsumptionZone: main zone uses most", () => {
    expect(peakConsumptionZone(READINGS)).toBe("main");
  });
});
