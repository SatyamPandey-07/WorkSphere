/**
 * Tests for venue capacity overflow protection.
 */

interface VenueCapacityState {
  venueId: string;
  currentOccupancy: number;
  maxCapacity: number;
  overflowThreshold: number; // pct above max allowed temporarily (e.g. 0.1 = 10%)
}

function isOverCapacity(state: VenueCapacityState): boolean {
  return state.currentOccupancy > state.maxCapacity;
}

function isOverflowAllowed(state: VenueCapacityState): boolean {
  const hardLimit = Math.floor(state.maxCapacity * (1 + state.overflowThreshold));
  return state.currentOccupancy <= hardLimit;
}

function capacityUtilization(state: VenueCapacityState): number {
  if (state.maxCapacity === 0) return 0;
  return Math.round((state.currentOccupancy / state.maxCapacity) * 100);
}

function canAcceptMore(state: VenueCapacityState): boolean {
  return isOverflowAllowed(state) && state.currentOccupancy < Math.floor(state.maxCapacity * (1 + state.overflowThreshold));
}

describe("Venue capacity overflow protection", () => {
  const state: VenueCapacityState = {
    venueId: "v1",
    currentOccupancy: 110,
    maxCapacity: 100,
    overflowThreshold: 0.1,
  };

  it("isOverCapacity: 110 > 100 → true", () => {
    expect(isOverCapacity(state)).toBe(true);
  });

  it("isOverCapacity: exactly at capacity → false", () => {
    expect(isOverCapacity({ ...state, currentOccupancy: 100 })).toBe(false);
  });

  it("isOverflowAllowed: 110 <= 110 (10% of 100) → true", () => {
    expect(isOverflowAllowed(state)).toBe(true);
  });

  it("isOverflowAllowed: 111 > 110 → false", () => {
    expect(isOverflowAllowed({ ...state, currentOccupancy: 111 })).toBe(false);
  });

  it("capacityUtilization: 110/100 = 110%", () => {
    expect(capacityUtilization(state)).toBe(110);
  });

  it("capacityUtilization: zero max → 0", () => {
    expect(capacityUtilization({ ...state, maxCapacity: 0 })).toBe(0);
  });

  it("canAcceptMore: at hard limit → false", () => {
    expect(canAcceptMore(state)).toBe(false);
  });

  it("canAcceptMore: below hard limit → true", () => {
    expect(canAcceptMore({ ...state, currentOccupancy: 105 })).toBe(true);
  });

  it("canAcceptMore: under max → true", () => {
    expect(canAcceptMore({ ...state, currentOccupancy: 90 })).toBe(true);
  });
});
