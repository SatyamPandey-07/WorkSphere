/**
 * Tests for venue dynamic pricing model (demand-based pricing).
 */

interface DemandFactor {
  occupancyRatio: number;    // 0-1
  daysUntilBooking: number;  // advance notice
  isWeekend: boolean;
  isHoliday: boolean;
  timeOfDay: "peak" | "off_peak";
}

function demandMultiplier(factor: DemandFactor): number {
  let multiplier = 1.0;

  // Occupancy
  if (factor.occupancyRatio >= 0.9) multiplier += 0.5;
  else if (factor.occupancyRatio >= 0.7) multiplier += 0.2;

  // Last-minute booking
  if (factor.daysUntilBooking <= 1) multiplier += 0.3;
  else if (factor.daysUntilBooking <= 3) multiplier += 0.1;

  // Weekend / holiday premium
  if (factor.isWeekend) multiplier += 0.15;
  if (factor.isHoliday) multiplier += 0.25;

  // Peak hours
  if (factor.timeOfDay === "peak") multiplier += 0.1;

  return Math.round(multiplier * 100) / 100;
}

function dynamicPrice(baseCents: number, factor: DemandFactor, maxMultiplier = 3.0): number {
  const multiplier = Math.min(demandMultiplier(factor), maxMultiplier);
  return Math.round(baseCents * multiplier);
}

describe("Venue dynamic pricing model", () => {
  const BASE_FACTOR: DemandFactor = {
    occupancyRatio: 0.5, daysUntilBooking: 7,
    isWeekend: false, isHoliday: false, timeOfDay: "off_peak",
  };

  it("no special factors → multiplier 1.0", () => {
    expect(demandMultiplier(BASE_FACTOR)).toBe(1.0);
  });

  it("high occupancy adds 0.5", () => {
    expect(demandMultiplier({ ...BASE_FACTOR, occupancyRatio: 0.95 })).toBeCloseTo(1.5);
  });

  it("last-minute booking adds 0.3", () => {
    expect(demandMultiplier({ ...BASE_FACTOR, daysUntilBooking: 0 })).toBeCloseTo(1.3);
  });

  it("weekend adds 0.15", () => {
    expect(demandMultiplier({ ...BASE_FACTOR, isWeekend: true })).toBeCloseTo(1.15);
  });

  it("holiday adds 0.25", () => {
    expect(demandMultiplier({ ...BASE_FACTOR, isHoliday: true })).toBeCloseTo(1.25);
  });

  it("all factors: high demand", () => {
    const highDemand: DemandFactor = { occupancyRatio: 0.95, daysUntilBooking: 0, isWeekend: true, isHoliday: true, timeOfDay: "peak" };
    expect(demandMultiplier(highDemand)).toBeGreaterThan(2.0);
  });

  it("dynamicPrice: base * multiplier", () => {
    expect(dynamicPrice(1000, { ...BASE_FACTOR, isWeekend: true })).toBe(1150);
  });

  it("dynamicPrice: capped at maxMultiplier", () => {
    const extreme: DemandFactor = { occupancyRatio: 0.99, daysUntilBooking: 0, isWeekend: true, isHoliday: true, timeOfDay: "peak" };
    expect(dynamicPrice(1000, extreme, 2.0)).toBe(2000);
  });
});
