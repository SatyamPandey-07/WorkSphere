/**
 * Tests for venue booking accessibility features and compliance.
 */

interface AccessibilityCheck {
  category: "visual" | "motor" | "cognitive" | "hearing";
  feature: string;
  implemented: boolean;
  level: "A" | "AA" | "AAA";
}

interface AccessibilityReport {
  venueId: string;
  checks: AccessibilityCheck[];
  wcagLevel: "A" | "AA" | "AAA" | "non_compliant";
  totalScore: number;
}

function wcagComplianceLevel(checks: AccessibilityCheck[]): "A" | "AA" | "AAA" | "non_compliant" {
  const implemented = checks.filter((c) => c.implemented);
  const levelA = checks.filter((c) => c.level === "A");
  const levelAA = checks.filter((c) => c.level === "A" || c.level === "AA");
  const allLevels = checks;

  if (allLevels.every((c) => implemented.some((i) => i.feature === c.feature))) return "AAA";
  if (levelAA.every((c) => implemented.some((i) => i.feature === c.feature))) return "AA";
  if (levelA.every((c) => implemented.some((i) => i.feature === c.feature))) return "A";
  return "non_compliant";
}

function accessibilityScore(checks: AccessibilityCheck[]): number {
  const weights = { A: 3, AA: 2, AAA: 1 };
  const totalWeight = checks.reduce((s, c) => s + weights[c.level], 0);
  const earnedWeight = checks.filter((c) => c.implemented).reduce((s, c) => s + weights[c.level], 0);
  if (totalWeight === 0) return 100;
  return Math.round((earnedWeight / totalWeight) * 100);
}

function missingByCategory(checks: AccessibilityCheck[], category: string): string[] {
  return checks
    .filter((c) => c.category === category && !c.implemented)
    .map((c) => c.feature);
}

const CHECKS: AccessibilityCheck[] = [
  { category: "visual",    feature: "alt_text",          implemented: true,  level: "A"   },
  { category: "visual",    feature: "high_contrast",     implemented: true,  level: "AA"  },
  { category: "motor",     feature: "keyboard_nav",      implemented: true,  level: "A"   },
  { category: "cognitive", feature: "clear_labels",      implemented: false, level: "A"   },
  { category: "hearing",   feature: "captions",          implemented: false, level: "AA"  },
  { category: "visual",    feature: "text_resize",       implemented: true,  level: "AA"  },
];

describe("Venue booking accessibility compliance", () => {
  it("wcagComplianceLevel: missing Level A → non_compliant", () => {
    expect(wcagComplianceLevel(CHECKS)).toBe("non_compliant"); // clear_labels (A) not implemented
  });

  it("wcagComplianceLevel: all Level A implemented → A", () => {
    const allA = CHECKS.map((c) => (c.level === "A" ? { ...c, implemented: true } : c));
    expect(wcagComplianceLevel(allA)).toBe("AA"); // depends on AA checks
  });

  it("accessibilityScore: 4 of 6 implemented with weights", () => {
    const score = accessibilityScore(CHECKS);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });

  it("missingByCategory: visual has none missing", () => {
    expect(missingByCategory(CHECKS, "visual")).toHaveLength(0);
  });

  it("missingByCategory: cognitive has 'clear_labels' missing", () => {
    expect(missingByCategory(CHECKS, "cognitive")).toContain("clear_labels");
  });

  it("missingByCategory: hearing has 'captions' missing", () => {
    expect(missingByCategory(CHECKS, "hearing")).toContain("captions");
  });
});
