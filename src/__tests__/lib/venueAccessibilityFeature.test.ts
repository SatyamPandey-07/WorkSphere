/**
 * Tests for venue accessibility feature scoring.
 */

interface AccessibilityFeatures {
  wheelchairRamp: boolean;
  elevator: boolean;
  accessibleRestroom: boolean;
  brailleSignage: boolean;
  hearingLoop: boolean;
  accessibleParking: boolean;
}

const ACCESSIBILITY_WEIGHTS: Record<keyof AccessibilityFeatures, number> = {
  wheelchairRamp:       25,
  elevator:             20,
  accessibleRestroom:   20,
  brailleSignage:       10,
  hearingLoop:          10,
  accessibleParking:    15,
};

function accessibilityScore(features: AccessibilityFeatures): number {
  return (Object.entries(features) as [keyof AccessibilityFeatures, boolean][])
    .filter(([, v]) => v)
    .reduce((sum, [k]) => sum + ACCESSIBILITY_WEIGHTS[k], 0);
}

function accessibilityLabel(score: number): "limited" | "partial" | "accessible" | "fully_accessible" {
  if (score < 25)  return "limited";
  if (score < 50)  return "partial";
  if (score < 85)  return "accessible";
  return "fully_accessible";
}

const NO_FEATURES: AccessibilityFeatures = {
  wheelchairRamp: false, elevator: false, accessibleRestroom: false,
  brailleSignage: false, hearingLoop: false, accessibleParking: false,
};
const ALL_FEATURES: AccessibilityFeatures = {
  wheelchairRamp: true, elevator: true, accessibleRestroom: true,
  brailleSignage: true, hearingLoop: true, accessibleParking: true,
};

describe("Venue accessibility scoring", () => {
  it("no features → 0", () => {
    expect(accessibilityScore(NO_FEATURES)).toBe(0);
  });

  it("all features → 100", () => {
    expect(accessibilityScore(ALL_FEATURES)).toBe(100);
  });

  it("wheelchair ramp only → 25", () => {
    expect(accessibilityScore({ ...NO_FEATURES, wheelchairRamp: true })).toBe(25);
  });

  it("label limited for score < 25", () => {
    expect(accessibilityLabel(10)).toBe("limited");
  });

  it("label partial for 25–49", () => {
    expect(accessibilityLabel(40)).toBe("partial");
  });

  it("label accessible for 50–84", () => {
    expect(accessibilityLabel(70)).toBe("accessible");
  });

  it("label fully_accessible for ≥ 85", () => {
    expect(accessibilityLabel(100)).toBe("fully_accessible");
  });

  it("full features earns fully_accessible", () => {
    expect(accessibilityLabel(accessibilityScore(ALL_FEATURES))).toBe("fully_accessible");
  });
});
