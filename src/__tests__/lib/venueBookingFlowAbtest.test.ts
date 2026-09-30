/**
 * Tests for A/B test assignment and conversion tracking for booking flows.
 */

type AbVariant = "control" | "treatment_a" | "treatment_b";

interface AbTestConfig {
  testId: string;
  name: string;
  variants: { id: AbVariant; weight: number }[];  // weights sum to 100
  isActive: boolean;
}

interface AbTestAssignment {
  userId: string;
  testId: string;
  variant: AbVariant;
  assignedAt: number;
  converted: boolean;
  convertedAt: number | null;
}

function assignVariant(config: AbTestConfig, userId: string, nowMs: number): AbTestAssignment {
  if (!config.isActive) throw new Error("Test is not active");
  // Deterministic assignment based on userId hash
  const hash = userId.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  let cumulative = 0;
  let selected: AbVariant = config.variants[0].id;
  for (const variant of config.variants) {
    cumulative += variant.weight;
    if (hash % 100 < cumulative) { selected = variant.id; break; }
  }
  return { userId, testId: config.testId, variant: selected, assignedAt: nowMs, converted: false, convertedAt: null };
}

function recordConversion(assignment: AbTestAssignment, nowMs: number): AbTestAssignment {
  if (assignment.converted) return assignment;
  return { ...assignment, converted: true, convertedAt: nowMs };
}

function conversionRateByVariant(
  assignments: AbTestAssignment[],
  testId: string
): Record<AbVariant, number> {
  const result: Record<AbVariant, number> = { control: 0, treatment_a: 0, treatment_b: 0 };
  const variants: AbVariant[] = ["control", "treatment_a", "treatment_b"];
  for (const variant of variants) {
    const variantAssignments = assignments.filter((a) => a.testId === testId && a.variant === variant);
    if (variantAssignments.length === 0) continue;
    const converted = variantAssignments.filter((a) => a.converted).length;
    result[variant] = Math.round((converted / variantAssignments.length) * 100);
  }
  return result;
}

const TEST_CONFIG: AbTestConfig = {
  testId: "test1", name: "Checkout Flow",
  variants: [
    { id: "control",     weight: 50 },
    { id: "treatment_a", weight: 30 },
    { id: "treatment_b", weight: 20 },
  ],
  isActive: true,
};

const NOW = 1_700_000_000_000;

describe("A/B test booking flow", () => {
  it("assignVariant: returns valid variant", () => {
    const assignment = assignVariant(TEST_CONFIG, "user123", NOW);
    expect(["control", "treatment_a", "treatment_b"]).toContain(assignment.variant);
  });

  it("assignVariant: same user gets same variant (deterministic)", () => {
    const a1 = assignVariant(TEST_CONFIG, "user123", NOW);
    const a2 = assignVariant(TEST_CONFIG, "user123", NOW + 1000);
    expect(a1.variant).toBe(a2.variant);
  });

  it("assignVariant: throws when inactive", () => {
    const inactive = { ...TEST_CONFIG, isActive: false };
    expect(() => assignVariant(inactive, "u1", NOW)).toThrow("not active");
  });

  it("recordConversion: sets converted", () => {
    const assignment = assignVariant(TEST_CONFIG, "u1", NOW);
    const converted = recordConversion(assignment, NOW);
    expect(converted.converted).toBe(true);
    expect(converted.convertedAt).toBe(NOW);
  });

  it("recordConversion: idempotent", () => {
    const assignment = assignVariant(TEST_CONFIG, "u1", NOW);
    const c1 = recordConversion(assignment, NOW);
    const c2 = recordConversion(c1, NOW + 1000);
    expect(c2.convertedAt).toBe(NOW); // unchanged
  });

  it("conversionRateByVariant: empty → 0%", () => {
    const rates = conversionRateByVariant([], "test1");
    expect(rates.control).toBe(0);
  });
});
