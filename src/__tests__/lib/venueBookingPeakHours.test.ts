/**
 * Tests for venue peak hours detection and surge pricing.
 */

interface HourlyDemand {
  hour: number;     // 0-23
  dayOfWeek: number; // 0=Sun
  avgBookings: number;
  avgRevenue: number;
}

interface PeakConfig {
  peakThreshold: number;   // % above average to be "peak"
  surgePricingFactor: number; // multiplier during peak
}

function hourlyAvg(demands: HourlyDemand[], field: "avgBookings" | "avgRevenue"): number {
  if (demands.length === 0) return 0;
  return demands.reduce((s, d) => s + d[field], 0) / demands.length;
}

function isPeakHour(demand: HourlyDemand, demands: HourlyDemand[], config: PeakConfig): boolean {
  const avg = hourlyAvg(demands, "avgBookings");
  return demand.avgBookings > avg * (1 + config.peakThreshold / 100);
}

function surgePrice(basePrice: number, demand: HourlyDemand, demands: HourlyDemand[], config: PeakConfig): number {
  if (isPeakHour(demand, demands, config)) {
    return Math.round(basePrice * config.surgePricingFactor * 100) / 100;
  }
  return basePrice;
}

function peakHours(demands: HourlyDemand[], config: PeakConfig): number[] {
  return demands.filter((d) => isPeakHour(d, demands, config)).map((d) => d.hour);
}

function busiestHour(demands: HourlyDemand[]): HourlyDemand | null {
  if (demands.length === 0) return null;
  return demands.reduce((max, d) => d.avgBookings > max.avgBookings ? d : max, demands[0]);
}

function revenueByTimeOfDay(demands: HourlyDemand[]): { morning: number; afternoon: number; evening: number; night: number } {
  const sum = (hours: number[]) => Math.round(demands.filter((d) => hours.includes(d.hour)).reduce((s, d) => s + d.avgRevenue, 0));
  return {
    morning:   sum([6,7,8,9,10,11]),
    afternoon: sum([12,13,14,15,16,17]),
    evening:   sum([18,19,20,21]),
    night:     sum([22,23,0,1,2,3,4,5]),
  };
}

const CONFIG: PeakConfig = { peakThreshold: 50, surgePricingFactor: 1.5 };
const DEMANDS: HourlyDemand[] = [
  { hour: 9,  dayOfWeek: 1, avgBookings: 5,  avgRevenue: 500 },
  { hour: 13, dayOfWeek: 1, avgBookings: 15, avgRevenue: 1500 },
  { hour: 18, dayOfWeek: 1, avgBookings: 20, avgRevenue: 2000 },
  { hour: 2,  dayOfWeek: 1, avgBookings: 1,  avgRevenue: 100 },
];

describe("Peak hours detection and surge pricing", () => {
  it("busiestHour: 18:00 is busiest", () => {
    expect(busiestHour(DEMANDS)?.hour).toBe(18);
  });

  it("isPeakHour: 18:00 (avg 20, overall avg ~10.25) → peak", () => {
    expect(isPeakHour(DEMANDS[2], DEMANDS, CONFIG)).toBe(true);
  });

  it("isPeakHour: 09:00 (avg 5) → not peak", () => {
    expect(isPeakHour(DEMANDS[0], DEMANDS, CONFIG)).toBe(false);
  });

  it("surgePrice: peak hour applies multiplier", () => {
    const base = 100;
    expect(surgePrice(base, DEMANDS[2], DEMANDS, CONFIG)).toBe(150);
  });

  it("surgePrice: non-peak → base price", () => {
    expect(surgePrice(100, DEMANDS[0], DEMANDS, CONFIG)).toBe(100);
  });

  it("peakHours: returns hours above threshold", () => {
    const peaks = peakHours(DEMANDS, CONFIG);
    expect(peaks).toContain(18);
    expect(peaks).not.toContain(9);
  });
});
