/**
 * Tests for venue health and safety compliance scoring.
 */

interface HealthSafetyChecklist {
  fireExtinguisher: boolean;
  firstAidKit: boolean;
  emergencyExits: boolean;
  sprinklerSystem: boolean;
  securityCameras: boolean;
  accessControl: boolean;
  safetySignage: boolean;
}

const SAFETY_WEIGHTS: Record<keyof HealthSafetyChecklist, number> = {
  fireExtinguisher:  20,
  firstAidKit:       10,
  emergencyExits:    25,
  sprinklerSystem:   15,
  securityCameras:   10,
  accessControl:     10,
  safetySignage:     10,
};

function safetyScore(checklist: HealthSafetyChecklist): number {
  return (Object.entries(checklist) as [keyof HealthSafetyChecklist, boolean][])
    .filter(([, v]) => v)
    .reduce((sum, [k]) => sum + SAFETY_WEIGHTS[k], 0);
}

function safetyGrade(score: number): "unsafe" | "basic" | "standard" | "certified" {
  if (score < 35) return "unsafe";
  if (score < 60) return "basic";
  if (score < 85) return "standard";
  return "certified";
}

function criticalItemsMissing(checklist: HealthSafetyChecklist): string[] {
  const critical: (keyof HealthSafetyChecklist)[] = ["fireExtinguisher", "emergencyExits"];
  return critical.filter((k) => !checklist[k]);
}

const EMPTY: HealthSafetyChecklist = {
  fireExtinguisher: false, firstAidKit: false, emergencyExits: false,
  sprinklerSystem: false, securityCameras: false, accessControl: false, safetySignage: false,
};

describe("Venue health and safety scoring", () => {
  it("empty checklist → 0", () => {
    expect(safetyScore(EMPTY)).toBe(0);
  });

  it("fire extinguisher only → 20", () => {
    expect(safetyScore({ ...EMPTY, fireExtinguisher: true })).toBe(20);
  });

  it("emergency exits → 25", () => {
    expect(safetyScore({ ...EMPTY, emergencyExits: true })).toBe(25);
  });

  it("full checklist → 100", () => {
    const full: HealthSafetyChecklist = {
      fireExtinguisher: true, firstAidKit: true, emergencyExits: true,
      sprinklerSystem: true, securityCameras: true, accessControl: true, safetySignage: true,
    };
    expect(safetyScore(full)).toBe(100);
  });

  it("grade unsafe for score < 35", () => {
    expect(safetyGrade(20)).toBe("unsafe");
  });

  it("grade basic for 35–59", () => {
    expect(safetyGrade(50)).toBe("basic");
  });

  it("grade standard for 60–84", () => {
    expect(safetyGrade(70)).toBe("standard");
  });

  it("grade certified for ≥ 85", () => {
    expect(safetyGrade(90)).toBe("certified");
  });

  it("criticalItemsMissing: lists both missing", () => {
    expect(criticalItemsMissing(EMPTY)).toHaveLength(2);
  });

  it("criticalItemsMissing: empty when all present", () => {
    const withCritical: HealthSafetyChecklist = { ...EMPTY, fireExtinguisher: true, emergencyExits: true };
    expect(criticalItemsMissing(withCritical)).toHaveLength(0);
  });
});
