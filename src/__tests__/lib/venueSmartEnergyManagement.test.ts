/**
 * Tests for venue smart energy management and optimization.
 */

interface EnergyZone {
  zoneId: string;
  venueId: string;
  name: string;
  currentLoadKw: number;
  maxLoadKw: number;
  isOccupied: boolean;
  scheduledOccupancyMs: number | null; // when next booking starts
  hvacEnabled: boolean;
  lightingPct: number;  // 0-100
}

function loadFactor(zone: EnergyZone): number {
  if (zone.maxLoadKw === 0) return 0;
  return Math.round((zone.currentLoadKw / zone.maxLoadKw) * 100);
}

function recommendEnergyMode(zone: EnergyZone, nowMs: number): "standby" | "economy" | "comfort" | "boost" {
  if (!zone.isOccupied) {
    const preConditionMs = 30 * 60_000; // 30 min pre-conditioning
    if (zone.scheduledOccupancyMs !== null && zone.scheduledOccupancyMs - nowMs <= preConditionMs) {
      return "economy"; // pre-condition zone
    }
    return "standby";
  }
  const load = loadFactor(zone);
  if (load >= 90) return "boost";
  return "comfort";
}

function energySavingsFromStandby(zones: EnergyZone[], venueId: string, nowMs: number): number {
  return zones
    .filter((z) => z.venueId === venueId && recommendEnergyMode(z, nowMs) === "standby")
    .reduce((sum, z) => sum + z.currentLoadKw, 0);
}

function optimizeZoneLighting(zone: EnergyZone): EnergyZone {
  if (!zone.isOccupied) {
    return { ...zone, lightingPct: 5 }; // security lighting only
  }
  if (zone.lightingPct > 70) {
    return { ...zone, lightingPct: 70 }; // cap at comfortable level
  }
  return zone;
}

const NOW = 1_700_000_000_000;
const ZONES: EnergyZone[] = [
  { zoneId: "z1", venueId: "v1", name: "Main Area",    currentLoadKw: 8,  maxLoadKw: 10, isOccupied: true,  scheduledOccupancyMs: null,        hvacEnabled: true,  lightingPct: 90 },
  { zoneId: "z2", venueId: "v1", name: "Meeting Room", currentLoadKw: 2,  maxLoadKw: 5,  isOccupied: false, scheduledOccupancyMs: NOW + 20 * 60_000, hvacEnabled: false, lightingPct: 10 },
  { zoneId: "z3", venueId: "v1", name: "Storage",      currentLoadKw: 0.5,maxLoadKw: 2,  isOccupied: false, scheduledOccupancyMs: null,        hvacEnabled: false, lightingPct: 0  },
];

describe("Venue smart energy management", () => {
  it("loadFactor: z1 = 80% (8/10)", () => {
    expect(loadFactor(ZONES[0])).toBe(80);
  });

  it("recommendEnergyMode: occupied zone → comfort", () => {
    expect(recommendEnergyMode(ZONES[0], NOW)).toBe("comfort");
  });

  it("recommendEnergyMode: upcoming booking in 20min → economy (pre-condition)", () => {
    expect(recommendEnergyMode(ZONES[1], NOW)).toBe("economy");
  });

  it("recommendEnergyMode: unoccupied no booking → standby", () => {
    expect(recommendEnergyMode(ZONES[2], NOW)).toBe("standby");
  });

  it("energySavingsFromStandby: z3 in standby = 0.5 kW", () => {
    const savings = energySavingsFromStandby(ZONES, "v1", NOW);
    expect(savings).toBeCloseTo(0.5, 1);
  });

  it("optimizeZoneLighting: occupied high lighting → cap at 70%", () => {
    const optimized = optimizeZoneLighting(ZONES[0]);
    expect(optimized.lightingPct).toBe(70);
  });

  it("optimizeZoneLighting: unoccupied → security lighting 5%", () => {
    const optimized = optimizeZoneLighting(ZONES[2]);
    expect(optimized.lightingPct).toBe(5);
  });
});
