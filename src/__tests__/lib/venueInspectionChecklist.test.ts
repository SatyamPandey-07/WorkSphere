/**
 * Tests for venue quarterly inspection checklist management.
 */

type InspectionCategory = "safety" | "cleanliness" | "equipment" | "compliance" | "aesthetics";
type ChecklistItemResult = "pass" | "fail" | "na" | "pending";

interface InspectionItem {
  itemId: string;
  category: InspectionCategory;
  description: string;
  result: ChecklistItemResult;
  notes?: string;
  requiresImmediateAction: boolean;
}

interface InspectionReport {
  reportId: string;
  venueId: string;
  inspectorId: string;
  date: string;
  items: InspectionItem[];
  overallResult: "pass" | "fail" | "conditional";
}

function failedItems(report: InspectionReport): InspectionItem[] {
  return report.items.filter((i) => i.result === "fail");
}

function criticalFailures(report: InspectionReport): InspectionItem[] {
  return report.items.filter((i) => i.result === "fail" && i.requiresImmediateAction);
}

function categoryPassRate(report: InspectionReport, category: InspectionCategory): number {
  const catItems = report.items.filter((i) => i.category === category && i.result !== "na");
  if (catItems.length === 0) return 100;
  const passed = catItems.filter((i) => i.result === "pass").length;
  return Math.round((passed / catItems.length) * 100);
}

function overallPassRate(report: InspectionReport): number {
  const relevant = report.items.filter((i) => i.result !== "na" && i.result !== "pending");
  if (relevant.length === 0) return 100;
  const passed = relevant.filter((i) => i.result === "pass").length;
  return Math.round((passed / relevant.length) * 100);
}

function updateItemResult(
  report: InspectionReport,
  itemId: string,
  result: ChecklistItemResult
): InspectionReport {
  return {
    ...report,
    items: report.items.map((i) => (i.itemId === itemId ? { ...i, result } : i)),
  };
}

const REPORT: InspectionReport = {
  reportId: "ir1", venueId: "v1", inspectorId: "ins1", date: "2026-10-01",
  items: [
    { itemId: "c1", category: "safety",     description: "Fire exits",  result: "pass",    requiresImmediateAction: false },
    { itemId: "c2", category: "safety",     description: "Extinguisher",result: "fail",    requiresImmediateAction: true  },
    { itemId: "c3", category: "cleanliness",description: "Desks",       result: "pass",    requiresImmediateAction: false },
    { itemId: "c4", category: "equipment",  description: "AC unit",     result: "fail",    requiresImmediateAction: false },
    { itemId: "c5", category: "compliance", description: "License",     result: "na",      requiresImmediateAction: false },
  ],
  overallResult: "conditional",
};

describe("Venue inspection checklist", () => {
  it("failedItems: 2 failed items", () => {
    expect(failedItems(REPORT)).toHaveLength(2);
  });

  it("criticalFailures: 1 critical (requires immediate)", () => {
    expect(criticalFailures(REPORT)).toHaveLength(1);
    expect(criticalFailures(REPORT)[0].itemId).toBe("c2");
  });

  it("categoryPassRate: safety = 50% (1/2)", () => {
    expect(categoryPassRate(REPORT, "safety")).toBe(50);
  });

  it("categoryPassRate: compliance = 100% (no applicable items)", () => {
    expect(categoryPassRate(REPORT, "compliance")).toBe(100);
  });

  it("overallPassRate: 2/4 applicable = 50%", () => {
    expect(overallPassRate(REPORT)).toBe(50);
  });

  it("updateItemResult: fixes failed item", () => {
    const updated = updateItemResult(REPORT, "c2", "pass");
    expect(updated.items.find((i) => i.itemId === "c2")!.result).toBe("pass");
  });

  it("updateItemResult is immutable", () => {
    updateItemResult(REPORT, "c2", "pass");
    expect(REPORT.items.find((i) => i.itemId === "c2")!.result).toBe("fail");
  });
});
