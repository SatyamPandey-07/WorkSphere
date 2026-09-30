/**
 * Tests for venue accessibility route planning for mobility-impaired visitors.
 */

interface AccessibilityRoute {
  venueId: string;
  hasElevator: boolean;
  hasAccessibleEntrance: boolean;
  hasAccessibleRestroom: boolean;
  maxStepHeight: number;     // cm; 0 = no steps
  slopeGrade: number;        // percentage; 0 = flat
  widthCm: number;           // corridor/door width
}

function isWheelchairAccessible(route: AccessibilityRoute): boolean {
  return (
    route.maxStepHeight === 0 &&
    route.slopeGrade <= 8 &&
    route.widthCm >= 90 &&
    route.hasAccessibleEntrance &&
    route.hasAccessibleRestroom
  );
}

function accessibilityScore(route: AccessibilityRoute): number {
  let score = 0;
  if (route.hasElevator) score += 25;
  if (route.hasAccessibleEntrance) score += 25;
  if (route.hasAccessibleRestroom) score += 20;
  if (route.maxStepHeight === 0) score += 15;
  if (route.slopeGrade <= 5) score += 10;
  if (route.widthCm >= 120) score += 5;
  return score;
}

function accessibilityLabel(score: number): "poor" | "fair" | "good" | "excellent" {
  if (score >= 85) return "excellent";
  if (score >= 60) return "good";
  if (score >= 35) return "fair";
  return "poor";
}

function routeBarriers(route: AccessibilityRoute): string[] {
  const barriers: string[] = [];
  if (route.maxStepHeight > 0) barriers.push(`Step: ${route.maxStepHeight}cm`);
  if (route.slopeGrade > 8) barriers.push(`Slope: ${route.slopeGrade}%`);
  if (route.widthCm < 90) barriers.push(`Narrow: ${route.widthCm}cm`);
  if (!route.hasAccessibleEntrance) barriers.push("No accessible entrance");
  return barriers;
}

const ACCESSIBLE_ROUTE: AccessibilityRoute = {
  venueId: "v1", hasElevator: true, hasAccessibleEntrance: true, hasAccessibleRestroom: true,
  maxStepHeight: 0, slopeGrade: 3, widthCm: 150,
};

const BARRIERS_ROUTE: AccessibilityRoute = {
  venueId: "v2", hasElevator: false, hasAccessibleEntrance: false, hasAccessibleRestroom: false,
  maxStepHeight: 15, slopeGrade: 12, widthCm: 70,
};

describe("Venue accessibility route", () => {
  it("isWheelchairAccessible: accessible route → true", () => {
    expect(isWheelchairAccessible(ACCESSIBLE_ROUTE)).toBe(true);
  });

  it("isWheelchairAccessible: step exists → false", () => {
    expect(isWheelchairAccessible(BARRIERS_ROUTE)).toBe(false);
  });

  it("accessibilityScore: accessible route = 100", () => {
    expect(accessibilityScore(ACCESSIBLE_ROUTE)).toBe(100);
  });

  it("accessibilityScore: barriers route = 0", () => {
    expect(accessibilityScore(BARRIERS_ROUTE)).toBe(0);
  });

  it("accessibilityLabel: excellent for score ≥ 85", () => {
    expect(accessibilityLabel(90)).toBe("excellent");
  });

  it("accessibilityLabel: poor for score < 35", () => {
    expect(accessibilityLabel(20)).toBe("poor");
  });

  it("routeBarriers: lists all barriers", () => {
    const barriers = routeBarriers(BARRIERS_ROUTE);
    expect(barriers.some((b) => /Step/i.test(b))).toBe(true);
    expect(barriers.some((b) => /Slope/i.test(b))).toBe(true);
    expect(barriers.some((b) => /Narrow/i.test(b))).toBe(true);
  });

  it("routeBarriers: accessible route has no barriers", () => {
    expect(routeBarriers(ACCESSIBLE_ROUTE)).toHaveLength(0);
  });
});
