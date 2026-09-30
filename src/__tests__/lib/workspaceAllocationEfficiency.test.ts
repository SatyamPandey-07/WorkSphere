/**
 * Tests for workspace allocation efficiency metrics.
 */

interface WorkspaceAllocation {
  workspaceId: string;
  venueId: string;
  totalDesks: number;
  allocatedDesks: number;
  peakOccupancyPct: number;
  avgOccupancyPct: number;
  unusedDaysPerMonth: number;
}

function allocationRate(alloc: WorkspaceAllocation): number {
  if (alloc.totalDesks === 0) return 0;
  return Math.round((alloc.allocatedDesks / alloc.totalDesks) * 100);
}

function underutilizationScore(alloc: WorkspaceAllocation): number {
  // Higher = more underutilized
  const allocationGap = 100 - allocationRate(alloc);
  const occupancyGap = alloc.allocatedDesks > 0
    ? Math.round((1 - alloc.avgOccupancyPct / 100) * 100)
    : 100;
  return Math.round((allocationGap + occupancyGap) / 2);
}

function utilizationGrade(alloc: WorkspaceAllocation): "excellent" | "good" | "fair" | "poor" {
  const rate = allocationRate(alloc);
  const avgOccupancy = alloc.avgOccupancyPct;
  const combined = Math.round((rate + avgOccupancy) / 2);
  if (combined >= 75) return "excellent";
  if (combined >= 50) return "good";
  if (combined >= 25) return "fair";
  return "poor";
}

function recommendOptimization(alloc: WorkspaceAllocation): string | null {
  if (alloc.unusedDaysPerMonth >= 15) return "Consider reducing workspace size";
  if (allocationRate(alloc) < 50) return "Offer discounts to increase allocation";
  if (alloc.avgOccupancyPct < 30) return "Review booking policies to improve occupancy";
  return null;
}

const ALLOC: WorkspaceAllocation = {
  workspaceId: "ws1", venueId: "v1",
  totalDesks: 20, allocatedDesks: 16,
  peakOccupancyPct: 90, avgOccupancyPct: 65,
  unusedDaysPerMonth: 3,
};

describe("Workspace allocation efficiency", () => {
  it("allocationRate: 16/20 = 80%", () => {
    expect(allocationRate(ALLOC)).toBe(80);
  });

  it("allocationRate: 0 total desks → 0", () => {
    expect(allocationRate({ ...ALLOC, totalDesks: 0 })).toBe(0);
  });

  it("utilizationGrade: (80+65)/2 = 72.5 → good", () => {
    expect(utilizationGrade(ALLOC)).toBe("good");
  });

  it("utilizationGrade: high allocation + occupancy → excellent", () => {
    expect(utilizationGrade({ ...ALLOC, allocatedDesks: 20, avgOccupancyPct: 80 })).toBe("excellent");
  });

  it("utilizationGrade: low → poor", () => {
    expect(utilizationGrade({ ...ALLOC, allocatedDesks: 2, avgOccupancyPct: 10 })).toBe("poor");
  });

  it("recommendOptimization: 15+ unused days → size reduction", () => {
    expect(recommendOptimization({ ...ALLOC, unusedDaysPerMonth: 15 })).toContain("reducing");
  });

  it("recommendOptimization: good allocation → no recommendation", () => {
    expect(recommendOptimization(ALLOC)).toBeNull();
  });

  it("underutilizationScore: low for efficient workspace", () => {
    expect(underutilizationScore(ALLOC)).toBeLessThan(50);
  });
});
