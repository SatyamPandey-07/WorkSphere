/**
 * Tests for venue Web Content Accessibility Guidelines (WCAG) scoring.
 */

type WcagLevel = "A" | "AA" | "AAA";

interface AccessibilityCriterion {
  id: string;
  level: WcagLevel;
  description: string;
  weight: number;
}

interface AccessibilityAudit {
  venueId: string;
  criteria: { criterionId: string; passed: boolean; notes: string }[];
  auditDate: number;
  auditorId: string;
}

const CRITERIA: AccessibilityCriterion[] = [
  { id: "1.1.1", level: "A",   description: "Non-text content alt text",   weight: 10 },
  { id: "1.3.1", level: "A",   description: "Info and relationships",       weight: 8 },
  { id: "2.1.1", level: "A",   description: "Keyboard accessible",          weight: 12 },
  { id: "1.4.3", level: "AA",  description: "Contrast ratio 4.5:1",         weight: 10 },
  { id: "2.4.6", level: "AA",  description: "Headings and labels",          weight: 6 },
  { id: "1.4.6", level: "AAA", description: "Enhanced contrast 7:1",        weight: 5 },
];

function passedCriteria(audit: AccessibilityAudit): string[] {
  return audit.criteria.filter((c) => c.passed).map((c) => c.criterionId);
}

function failedCriteria(audit: AccessibilityAudit, level?: WcagLevel): string[] {
  const failed = audit.criteria.filter((c) => !c.passed).map((c) => c.criterionId);
  if (!level) return failed;
  const levelIds = CRITERIA.filter((c) => c.level === level).map((c) => c.id);
  return failed.filter((id) => levelIds.includes(id));
}

function wcagScore(audit: AccessibilityAudit): number {
  const totalWeight = CRITERIA.reduce((s, c) => s + c.weight, 0);
  const passedWeight = audit.criteria
    .filter((c) => c.passed)
    .reduce((s, c) => {
      const criterion = CRITERIA.find((cr) => cr.id === c.criterionId);
      return s + (criterion?.weight ?? 0);
    }, 0);
  return Math.round((passedWeight / totalWeight) * 100);
}

function meetsLevel(audit: AccessibilityAudit, level: WcagLevel): boolean {
  const levelIds = CRITERIA.filter((c) => c.level === level).map((c) => c.id);
  return levelIds.every((id) => audit.criteria.some((c) => c.criterionId === id && c.passed));
}

const AUDIT: AccessibilityAudit = {
  venueId: "v1", auditDate: 1_700_000_000_000, auditorId: "a1",
  criteria: [
    { criterionId: "1.1.1", passed: true,  notes: "" },
    { criterionId: "1.3.1", passed: true,  notes: "" },
    { criterionId: "2.1.1", passed: false, notes: "Missing keyboard focus" },
    { criterionId: "1.4.3", passed: true,  notes: "" },
    { criterionId: "2.4.6", passed: true,  notes: "" },
    { criterionId: "1.4.6", passed: false, notes: "Contrast 6.8:1" },
  ],
};

describe("WCAG accessibility scoring", () => {
  it("passedCriteria: 4 passed", () => {
    expect(passedCriteria(AUDIT).length).toBe(4);
  });

  it("failedCriteria: 2 failed total", () => {
    expect(failedCriteria(AUDIT).length).toBe(2);
  });

  it("failedCriteria: 1 failed at level A (keyboard)", () => {
    expect(failedCriteria(AUDIT, "A").length).toBe(1);
  });

  it("meetsLevel: all AA criteria pass → AA conformance", () => {
    expect(meetsLevel(AUDIT, "AA")).toBe(true);
  });

  it("meetsLevel: keyboard (A) fails → A not met", () => {
    expect(meetsLevel(AUDIT, "A")).toBe(false);
  });

  it("wcagScore: 4 passing criteria → partial score", () => {
    const score = wcagScore(AUDIT);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});
