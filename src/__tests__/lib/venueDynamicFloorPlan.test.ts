/**
 * Tests for dynamic floor plan reconfiguration for events.
 */

interface FloorConfiguration {
  configId: string;
  venueId: string;
  name: string;
  layout: "boardroom" | "theater" | "classroom" | "u_shape" | "cabaret" | "standing";
  seatingCapacity: number;
  setupMinutes: number;
  teardownMinutes: number;
  requiredStaff: number;
}

function totalEventBlockMinutes(config: FloorConfiguration, eventDurationMinutes: number): number {
  return config.setupMinutes + eventDurationMinutes + config.teardownMinutes;
}

function isCapacitySufficient(config: FloorConfiguration, requiredSeats: number): boolean {
  return config.seatingCapacity >= requiredSeats;
}

function recommendConfiguration(
  configs: FloorConfiguration[],
  requiredSeats: number,
  eventType: "conference" | "presentation" | "workshop" | "social"
): FloorConfiguration | null {
  const layoutPreference: Record<string, FloorConfiguration["layout"][]> = {
    conference:   ["boardroom", "u_shape"],
    presentation: ["theater", "classroom"],
    workshop:     ["cabaret", "classroom"],
    social:       ["standing", "cabaret"],
  };
  const preferred = layoutPreference[eventType];
  const eligible = configs
    .filter((c) => isCapacitySufficient(c, requiredSeats))
    .sort((a, b) => {
      const aIdx = preferred.indexOf(a.layout);
      const bIdx = preferred.indexOf(b.layout);
      const aScore = aIdx === -1 ? 99 : aIdx;
      const bScore = bIdx === -1 ? 99 : bIdx;
      return aScore - bScore;
    });
  return eligible[0] ?? null;
}

const CONFIGS: FloorConfiguration[] = [
  { configId: "c1", venueId: "v1", name: "Boardroom",  layout: "boardroom", seatingCapacity: 20, setupMinutes: 15, teardownMinutes: 10, requiredStaff: 1 },
  { configId: "c2", venueId: "v1", name: "Theater",    layout: "theater",   seatingCapacity: 80, setupMinutes: 45, teardownMinutes: 30, requiredStaff: 3 },
  { configId: "c3", venueId: "v1", name: "Workshop",   layout: "cabaret",   seatingCapacity: 40, setupMinutes: 60, teardownMinutes: 45, requiredStaff: 2 },
];

describe("Dynamic floor plan configuration", () => {
  it("totalEventBlockMinutes: boardroom 60min event = 15+60+10 = 85", () => {
    expect(totalEventBlockMinutes(CONFIGS[0], 60)).toBe(85);
  });

  it("isCapacitySufficient: 15 needed, 20 available → true", () => {
    expect(isCapacitySufficient(CONFIGS[0], 15)).toBe(true);
  });

  it("isCapacitySufficient: 25 needed, 20 available → false", () => {
    expect(isCapacitySufficient(CONFIGS[0], 25)).toBe(false);
  });

  it("recommendConfiguration: conference with 10 seats → boardroom", () => {
    const rec = recommendConfiguration(CONFIGS, 10, "conference");
    expect(rec!.layout).toBe("boardroom");
  });

  it("recommendConfiguration: presentation with 50 seats → theater", () => {
    const rec = recommendConfiguration(CONFIGS, 50, "presentation");
    expect(rec!.layout).toBe("theater");
  });

  it("recommendConfiguration: too many seats → null", () => {
    expect(recommendConfiguration(CONFIGS, 100, "conference")).toBeNull();
  });

  it("social event → cabaret style preferred", () => {
    const rec = recommendConfiguration(CONFIGS, 30, "social");
    expect(rec!.layout).toBe("cabaret");
  });
});
