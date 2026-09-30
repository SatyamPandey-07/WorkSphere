/**
 * Tests for venue accessibility wayfinding for mobility-impaired visitors.
 */

interface WayfindingPath {
  pathId: string;
  venueId: string;
  from: string;  // location name
  to: string;
  steps: {
    instruction: string;
    distanceMeters: number;
    hasElevator?: boolean;
    hasTactileGuide?: boolean;
  }[];
  totalDistanceMeters: number;
  isWheelchairFriendly: boolean;
  estimatedMinutes: number;
}

function pathTotalDistance(path: WayfindingPath): number {
  return path.steps.reduce((sum, step) => sum + step.distanceMeters, 0);
}

function hasElevatorOnPath(path: WayfindingPath): boolean {
  return path.steps.some((step) => step.hasElevator === true);
}

function accessiblePaths(paths: WayfindingPath[], venueId: string): WayfindingPath[] {
  return paths.filter((p) => p.venueId === venueId && p.isWheelchairFriendly);
}

function shortestAccessiblePath(
  paths: WayfindingPath[],
  venueId: string,
  from: string,
  to: string
): WayfindingPath | null {
  const matching = paths.filter(
    (p) => p.venueId === venueId && p.from === from && p.to === to && p.isWheelchairFriendly
  );
  if (matching.length === 0) return null;
  return matching.reduce((min, p) => p.totalDistanceMeters < min.totalDistanceMeters ? p : min);
}

function pathEstimatedMinutes(path: WayfindingPath, speedMeterPerMin = 50): number {
  return Math.ceil(path.totalDistanceMeters / speedMeterPerMin);
}

const PATHS: WayfindingPath[] = [
  {
    pathId: "wp1", venueId: "v1", from: "entrance", to: "workzone", isWheelchairFriendly: true, estimatedMinutes: 3,
    steps: [
      { instruction: "Turn left", distanceMeters: 10 },
      { instruction: "Take elevator to floor 2", distanceMeters: 5, hasElevator: true },
      { instruction: "Straight ahead 30m", distanceMeters: 30 },
    ],
    totalDistanceMeters: 45,
  },
  {
    pathId: "wp2", venueId: "v1", from: "entrance", to: "workzone", isWheelchairFriendly: false, estimatedMinutes: 2,
    steps: [
      { instruction: "Take stairs", distanceMeters: 20 },
      { instruction: "Straight ahead", distanceMeters: 25 },
    ],
    totalDistanceMeters: 45,
  },
];

describe("Venue accessibility wayfinding", () => {
  it("pathTotalDistance: sums all step distances", () => {
    expect(pathTotalDistance(PATHS[0])).toBe(45);
  });

  it("hasElevatorOnPath: wp1 has elevator → true", () => {
    expect(hasElevatorOnPath(PATHS[0])).toBe(true);
  });

  it("hasElevatorOnPath: wp2 no elevator → false", () => {
    expect(hasElevatorOnPath(PATHS[1])).toBe(false);
  });

  it("accessiblePaths: only wp1 is wheelchair friendly", () => {
    const accessible = accessiblePaths(PATHS, "v1");
    expect(accessible).toHaveLength(1);
    expect(accessible[0].pathId).toBe("wp1");
  });

  it("shortestAccessiblePath: returns wp1", () => {
    const shortest = shortestAccessiblePath(PATHS, "v1", "entrance", "workzone");
    expect(shortest!.pathId).toBe("wp1");
  });

  it("shortestAccessiblePath: no accessible match → null", () => {
    expect(shortestAccessiblePath(PATHS, "v1", "entrance", "kitchen")).toBeNull();
  });

  it("pathEstimatedMinutes: 45m / 50m/min = 1 min (ceiling)", () => {
    expect(pathEstimatedMinutes(PATHS[0])).toBe(1);
  });
});
