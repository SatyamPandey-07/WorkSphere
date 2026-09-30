/**
 * Tests for real-time demand-based price surge detection.
 */

interface DemandSignal {
  venueId: string;
  currentOccupancy: number;
  maxCapacity: number;
  pendingBookings: number; // bookings not yet checked in
}

function occupancyRatio(signal: DemandSignal): number {
  return (signal.currentOccupancy + signal.pendingBookings) / signal.maxCapacity;
}

function surgeMultiplier(signal: DemandSignal): number {
  const ratio = occupancyRatio(signal);
  if (ratio >= 0.9) return 2.0;
  if (ratio >= 0.75) return 1.5;
  if (ratio >= 0.5) return 1.2;
  return 1.0;
}

function surgedPrice(baseCents: number, signal: DemandSignal): number {
  return Math.round(baseCents * surgeMultiplier(signal));
}

const LOW_DEMAND: DemandSignal    = { venueId: "v1", currentOccupancy: 5,  maxCapacity: 100, pendingBookings: 10 };
const MED_DEMAND: DemandSignal    = { venueId: "v1", currentOccupancy: 40, maxCapacity: 100, pendingBookings: 15 };
const HIGH_DEMAND: DemandSignal   = { venueId: "v1", currentOccupancy: 65, maxCapacity: 100, pendingBookings: 15 };
const EXTREME_DEMAND: DemandSignal= { venueId: "v1", currentOccupancy: 80, maxCapacity: 100, pendingBookings: 15 };

describe("Price surge detection", () => {
  it("low demand: multiplier 1.0", () => {
    expect(surgeMultiplier(LOW_DEMAND)).toBe(1.0);
  });

  it("medium demand (55%): multiplier 1.2", () => {
    expect(surgeMultiplier(MED_DEMAND)).toBe(1.2);
  });

  it("high demand (80%): multiplier 1.5", () => {
    expect(surgeMultiplier(HIGH_DEMAND)).toBe(1.5);
  });

  it("extreme demand (95%): multiplier 2.0", () => {
    expect(surgeMultiplier(EXTREME_DEMAND)).toBe(2.0);
  });

  it("surgedPrice no surge = base price", () => {
    expect(surgedPrice(1000, LOW_DEMAND)).toBe(1000);
  });

  it("surgedPrice 2x surge", () => {
    expect(surgedPrice(1000, EXTREME_DEMAND)).toBe(2000);
  });

  it("occupancyRatio includes pending bookings", () => {
    expect(occupancyRatio(LOW_DEMAND)).toBeCloseTo(0.15);
  });

  it("full capacity → ratio 1.0", () => {
    const full: DemandSignal = { venueId: "v1", currentOccupancy: 100, maxCapacity: 100, pendingBookings: 0 };
    expect(occupancyRatio(full)).toBe(1.0);
  });
});
