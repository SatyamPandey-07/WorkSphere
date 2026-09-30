/**
 * Tests for venue accessibility feature map generation.
 */

interface AccessibilityFeaturePoint {
  id: string;
  type: "entrance" | "elevator" | "restroom" | "parking" | "charging";
  floor: number;
  position: { x: number; y: number };
  isAccessible: boolean;
  description: string;
}

function nearestAccessibleFeature(
  features: AccessibilityFeaturePoint[],
  type: AccessibilityFeaturePoint["type"],
  currentX: number,
  currentY: number
): AccessibilityFeaturePoint | null {
  const eligible = features.filter((f) => f.type === type && f.isAccessible);
  if (eligible.length === 0) return null;
  return eligible.reduce((nearest, f) => {
    const distA = Math.hypot(f.position.x - currentX, f.position.y - currentY);
    const distB = Math.hypot(nearest.position.x - currentX, nearest.position.y - currentY);
    return distA < distB ? f : nearest;
  });
}

function featuresOnFloor(
  features: AccessibilityFeaturePoint[],
  floor: number
): AccessibilityFeaturePoint[] {
  return features.filter((f) => f.floor === floor && f.isAccessible);
}

function accessibilityGaps(
  features: AccessibilityFeaturePoint[],
  floors: number[]
): Record<string, string[]> {
  const required: AccessibilityFeaturePoint["type"][] = ["entrance", "restroom"];
  const gaps: Record<string, string[]> = {};
  for (const floor of floors) {
    const floorFeatures = features.filter((f) => f.floor === floor && f.isAccessible);
    const missing = required.filter((r) => !floorFeatures.some((f) => f.type === r));
    if (missing.length > 0) gaps[`floor_${floor}`] = missing;
  }
  return gaps;
}

const FEATURES: AccessibilityFeaturePoint[] = [
  { id: "f1", type: "entrance",  floor: 1, position: { x: 0, y: 0 },    isAccessible: true,  description: "Main entrance ramp" },
  { id: "f2", type: "elevator",  floor: 1, position: { x: 10, y: 5 },   isAccessible: true,  description: "Central elevator"   },
  { id: "f3", type: "restroom",  floor: 1, position: { x: 20, y: 0 },   isAccessible: true,  description: "Accessible restroom"},
  { id: "f4", type: "elevator",  floor: 2, position: { x: 10, y: 5 },   isAccessible: true,  description: "Floor 2 elevator"   },
  { id: "f5", type: "restroom",  floor: 1, position: { x: 5, y: 5 },    isAccessible: false, description: "Standard restroom"  },
];

describe("Venue accessibility map", () => {
  it("nearestAccessibleFeature: nearest elevator to (0,0)", () => {
    const nearest = nearestAccessibleFeature(FEATURES, "elevator", 0, 0);
    expect(nearest!.id).toBe("f2");
  });

  it("nearestAccessibleFeature: no restroom on floor 2 → null", () => {
    expect(nearestAccessibleFeature(FEATURES.filter((f) => f.floor === 2), "restroom", 0, 0)).toBeNull();
  });

  it("featuresOnFloor: floor 1 has 3 accessible features", () => {
    expect(featuresOnFloor(FEATURES, 1)).toHaveLength(3);
  });

  it("featuresOnFloor: excludes non-accessible (f5)", () => {
    const floor1 = featuresOnFloor(FEATURES, 1);
    expect(floor1.every((f) => f.isAccessible)).toBe(true);
  });

  it("accessibilityGaps: floor 2 missing entrance and restroom", () => {
    const gaps = accessibilityGaps(FEATURES, [1, 2]);
    expect(gaps.floor_2).toContain("entrance");
    expect(gaps.floor_2).toContain("restroom");
  });

  it("accessibilityGaps: floor 1 has no gaps", () => {
    const gaps = accessibilityGaps(FEATURES, [1]);
    expect(gaps.floor_1).toBeUndefined();
  });
});
