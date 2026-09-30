/**
 * Tests for workspace house rules enforcement.
 */

type RuleCategory = "noise" | "food" | "calls" | "pets" | "guests";

interface WorkspaceRule {
  category: RuleCategory;
  description: string;
  severity: "info" | "warning" | "strict";
}

interface RuleViolation {
  userId: string;
  ruleCategory: RuleCategory;
  reportedAt: number;
}

function activeViolations(
  violations: RuleViolation[],
  userId: string,
  windowMs: number,
  nowMs: number
): RuleViolation[] {
  return violations.filter(
    (v) => v.userId === userId && nowMs - v.reportedAt <= windowMs
  );
}

function canEnterWorkspace(
  violations: RuleViolation[],
  userId: string,
  windowMs: number,
  maxViolations: number,
  nowMs: number
): boolean {
  return activeViolations(violations, userId, windowMs, nowMs).length < maxViolations;
}

function strictViolations(
  violations: RuleViolation[],
  rules: WorkspaceRule[]
): RuleViolation[] {
  const strictCategories = new Set(
    rules.filter((r) => r.severity === "strict").map((r) => r.category)
  );
  return violations.filter((v) => strictCategories.has(v.ruleCategory));
}

const NOW = 1_700_000_000_000;
const RULES: WorkspaceRule[] = [
  { category: "noise", description: "Quiet zone",  severity: "strict"  },
  { category: "food",  description: "No hot food",  severity: "warning" },
  { category: "pets",  description: "No pets",      severity: "strict"  },
];
const VIOLATIONS: RuleViolation[] = [
  { userId: "u1", ruleCategory: "noise", reportedAt: NOW - 1000  },
  { userId: "u1", ruleCategory: "food",  reportedAt: NOW - 2000  },
  { userId: "u2", ruleCategory: "pets",  reportedAt: NOW - 500   },
  { userId: "u1", ruleCategory: "noise", reportedAt: NOW - 900_000 }, // old
];

describe("Workspace rule enforcement", () => {
  it("activeViolations within window", () => {
    const active = activeViolations(VIOLATIONS, "u1", 3_600_000, NOW);
    expect(active).toHaveLength(2); // old noise excluded
  });

  it("activeViolations outside window → empty", () => {
    const active = activeViolations(VIOLATIONS, "u1", 100, NOW);
    expect(active).toHaveLength(0);
  });

  it("canEnterWorkspace when under threshold", () => {
    expect(canEnterWorkspace(VIOLATIONS, "u1", 3_600_000, 3, NOW)).toBe(true);
  });

  it("canEnterWorkspace when at or over threshold", () => {
    expect(canEnterWorkspace(VIOLATIONS, "u1", 3_600_000, 2, NOW)).toBe(false);
  });

  it("canEnterWorkspace: no violations → allowed", () => {
    expect(canEnterWorkspace(VIOLATIONS, "u99", 3_600_000, 1, NOW)).toBe(true);
  });

  it("strictViolations filters by strict severity", () => {
    const strict = strictViolations(VIOLATIONS, RULES);
    const categories = strict.map((v) => v.ruleCategory);
    expect(categories).toContain("noise");
    expect(categories).toContain("pets");
    expect(categories).not.toContain("food");
  });
});
