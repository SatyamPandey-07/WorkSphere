/**
 * Tests for user crowd-report flagging and abuse threshold.
 */

interface AbuseReport {
  reportId: string;
  targetId: string;
  targetType: "review" | "venue" | "user";
  reportedBy: string;
  reason: "spam" | "offensive" | "misinformation" | "other";
  createdAt: number;
}

function countReports(reports: AbuseReport[], targetId: string): number {
  return reports.filter((r) => r.targetId === targetId).length;
}

function isAutoFlagged(reports: AbuseReport[], targetId: string, threshold = 3): boolean {
  return countReports(reports, targetId) >= threshold;
}

function reportsByType(
  reports: AbuseReport[],
  targetType: AbuseReport["targetType"]
): AbuseReport[] {
  return reports.filter((r) => r.targetType === targetType);
}

function uniqueReporters(reports: AbuseReport[], targetId: string): string[] {
  return [...new Set(reports.filter((r) => r.targetId === targetId).map((r) => r.reportedBy))];
}

const BASE = 1_700_000_000_000;
const REPORTS: AbuseReport[] = [
  { reportId: "r1", targetId: "rev1", targetType: "review", reportedBy: "u1", reason: "spam",      createdAt: BASE },
  { reportId: "r2", targetId: "rev1", targetType: "review", reportedBy: "u2", reason: "offensive", createdAt: BASE + 100 },
  { reportId: "r3", targetId: "rev1", targetType: "review", reportedBy: "u3", reason: "spam",      createdAt: BASE + 200 },
  { reportId: "r4", targetId: "v1",   targetType: "venue",  reportedBy: "u1", reason: "other",     createdAt: BASE + 300 },
];

describe("Crowd report abuse flagging", () => {
  it("countReports for rev1 → 3", () => {
    expect(countReports(REPORTS, "rev1")).toBe(3);
  });

  it("countReports unknown target → 0", () => {
    expect(countReports(REPORTS, "unknown")).toBe(0);
  });

  it("isAutoFlagged when threshold met", () => {
    expect(isAutoFlagged(REPORTS, "rev1", 3)).toBe(true);
  });

  it("isAutoFlagged below threshold", () => {
    expect(isAutoFlagged(REPORTS, "rev1", 4)).toBe(false);
  });

  it("isAutoFlagged single report below default threshold", () => {
    expect(isAutoFlagged(REPORTS, "v1")).toBe(false);
  });

  it("reportsByType returns only matching type", () => {
    expect(reportsByType(REPORTS, "review")).toHaveLength(3);
    expect(reportsByType(REPORTS, "venue")).toHaveLength(1);
  });

  it("uniqueReporters counts distinct users", () => {
    const reporters = uniqueReporters(REPORTS, "rev1");
    expect(reporters).toHaveLength(3);
    expect(reporters).toContain("u1");
  });

  it("uniqueReporters unknown target → empty", () => {
    expect(uniqueReporters(REPORTS, "x")).toHaveLength(0);
  });
});
