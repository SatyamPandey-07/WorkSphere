/**
 * Tests for venue booking WCAG accessibility compliance checking.
 */

interface AccessibilityIssue {
  issueId: string;
  pageId: string;
  wcagCriteria: string;
  severity: "A" | "AA" | "AAA";
  description: string;
  element?: string;
  isFixed: boolean;
  fixedAt?: number;
}

function openIssues(issues: AccessibilityIssue[], pageId: string): AccessibilityIssue[] {
  return issues.filter((i) => i.pageId === pageId && !i.isFixed);
}

function complianceSummary(issues: AccessibilityIssue[], pageId: string): {
  totalIssues: number;
  fixedIssues: number;
  openA: number;
  openAA: number;
  openAAA: number;
} {
  const pageIssues = issues.filter((i) => i.pageId === pageId);
  const open = pageIssues.filter((i) => !i.isFixed);
  return {
    totalIssues: pageIssues.length,
    fixedIssues: pageIssues.filter((i) => i.isFixed).length,
    openA:   open.filter((i) => i.severity === "A").length,
    openAA:  open.filter((i) => i.severity === "AA").length,
    openAAA: open.filter((i) => i.severity === "AAA").length,
  };
}

function isWcagACompliant(issues: AccessibilityIssue[], pageId: string): boolean {
  return issues.filter((i) => i.pageId === pageId && i.severity === "A" && !i.isFixed).length === 0;
}

function fixIssue(issues: AccessibilityIssue[], issueId: string, nowMs: number): AccessibilityIssue[] {
  return issues.map((i) =>
    i.issueId === issueId ? { ...i, isFixed: true, fixedAt: nowMs } : i
  );
}

function issuesByWcagCriteria(issues: AccessibilityIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  issues.filter((i) => !i.isFixed).forEach((i) => {
    counts[i.wcagCriteria] = (counts[i.wcagCriteria] ?? 0) + 1;
  });
  return counts;
}

const NOW = 1_700_000_000_000;
const ISSUES: AccessibilityIssue[] = [
  { issueId: "ai1", pageId: "booking",     wcagCriteria: "1.1.1", severity: "A",   description: "Missing alt text",        isFixed: false },
  { issueId: "ai2", pageId: "booking",     wcagCriteria: "2.4.3", severity: "AA",  description: "Focus order issue",       isFixed: true, fixedAt: NOW - 1000 },
  { issueId: "ai3", pageId: "booking",     wcagCriteria: "1.4.3", severity: "AA",  description: "Low contrast",            isFixed: false },
  { issueId: "ai4", pageId: "search",      wcagCriteria: "1.1.1", severity: "A",   description: "Missing alt text",        isFixed: false },
  { issueId: "ai5", pageId: "booking",     wcagCriteria: "1.4.6", severity: "AAA", description: "Enhanced contrast",       isFixed: false },
];

describe("Venue booking accessibility compliance", () => {
  it("openIssues: booking page has 3 open issues", () => {
    expect(openIssues(ISSUES, "booking")).toHaveLength(3);
  });

  it("complianceSummary: correct counts for booking page", () => {
    const summary = complianceSummary(ISSUES, "booking");
    expect(summary.totalIssues).toBe(4);
    expect(summary.fixedIssues).toBe(1);
    expect(summary.openA).toBe(1);
    expect(summary.openAA).toBe(1);
    expect(summary.openAAA).toBe(1);
  });

  it("isWcagACompliant: booking has open A issue → false", () => {
    expect(isWcagACompliant(ISSUES, "booking")).toBe(false);
  });

  it("fixIssue: marks as fixed", () => {
    const updated = fixIssue(ISSUES, "ai1", NOW);
    expect(updated.find((i) => i.issueId === "ai1")!.isFixed).toBe(true);
    expect(updated.find((i) => i.issueId === "ai1")!.fixedAt).toBe(NOW);
  });

  it("issuesByWcagCriteria: 1.1.1 has 2 open issues", () => {
    const counts = issuesByWcagCriteria(ISSUES);
    expect(counts["1.1.1"]).toBe(2); // ai1 (booking) + ai4 (search)
  });
});
