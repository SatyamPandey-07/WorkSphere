/**
 * Tests for venue space optimization through smart booking distribution.
 */

interface SpaceBookingLoad {
  spaceId: string;
  venueId: string;
  totalCapacity: number;
  bookedHours: number;
  availableHours: number;
  avgOccupancyPct: number;
}

function utilizationBalance(loads: SpaceBookingLoad[], venueId: string): number {
  const venue = loads.filter((l) => l.venueId === venueId);
  if (venue.length < 2) return 100; // perfect balance with 0 or 1 space
  const occupancies = venue.map((l) => l.avgOccupancyPct);
  const avg = occupancies.reduce((s, o) => s + o, 0) / occupancies.length;
  const variance = occupancies.reduce((s, o) => s + (o - avg) ** 2, 0) / occupancies.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Math.round(100 - stdDev * 2));
}

function overloadedSpaces(loads: SpaceBookingLoad[], venueId: string, threshold = 90): SpaceBookingLoad[] {
  return loads.filter((l) => l.venueId === venueId && l.avgOccupancyPct >= threshold);
}

function underusedSpaces(loads: SpaceBookingLoad[], venueId: string, threshold = 30): SpaceBookingLoad[] {
  return loads.filter((l) => l.venueId === venueId && l.avgOccupancyPct <= threshold);
}

function redistributionOpportunity(
  overloaded: SpaceBookingLoad[],
  underused: SpaceBookingLoad[]
): number {
  const overloadedCapacity = overloaded.reduce((s, l) => s + (l.totalCapacity * (l.avgOccupancyPct - 80) / 100), 0);
  const underusedCapacity = underused.reduce((s, l) => s + (l.totalCapacity * (80 - l.avgOccupancyPct) / 100), 0);
  return Math.min(overloadedCapacity, underusedCapacity);
}

const LOADS: SpaceBookingLoad[] = [
  { spaceId: "sp1", venueId: "v1", totalCapacity: 20, bookedHours: 800, availableHours: 200, avgOccupancyPct: 95 },
  { spaceId: "sp2", venueId: "v1", totalCapacity: 30, bookedHours: 300, availableHours: 700, avgOccupancyPct: 25 },
  { spaceId: "sp3", venueId: "v1", totalCapacity: 15, bookedHours: 600, availableHours: 400, avgOccupancyPct: 70 },
  { spaceId: "sp4", venueId: "v2", totalCapacity: 25, bookedHours: 900, availableHours: 100, avgOccupancyPct: 92 },
];

describe("Venue space optimization", () => {
  it("overloadedSpaces: sp1 (95%) overloaded", () => {
    const overloaded = overloadedSpaces(LOADS, "v1");
    expect(overloaded.map((l) => l.spaceId)).toContain("sp1");
    expect(overloaded.map((l) => l.spaceId)).not.toContain("sp3");
  });

  it("underusedSpaces: sp2 (25%) underused", () => {
    const underused = underusedSpaces(LOADS, "v1");
    expect(underused.map((l) => l.spaceId)).toContain("sp2");
  });

  it("utilizationBalance: perfect balance → 100", () => {
    const balanced = [
      { ...LOADS[0], avgOccupancyPct: 70 },
      { ...LOADS[1], avgOccupancyPct: 70 },
    ];
    expect(utilizationBalance(balanced, "v1")).toBe(100);
  });

  it("utilizationBalance: high variance → lower score", () => {
    const balance = utilizationBalance(LOADS, "v1");
    expect(balance).toBeLessThan(100);
  });

  it("redistributionOpportunity: positive when overloaded + underused", () => {
    const overloaded = overloadedSpaces(LOADS, "v1");
    const underused = underusedSpaces(LOADS, "v1");
    if (overloaded.length > 0 && underused.length > 0) {
      expect(redistributionOpportunity(overloaded, underused)).toBeGreaterThan(0);
    }
  });
});
