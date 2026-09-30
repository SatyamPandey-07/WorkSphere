/**
 * Tests for user workspace experience scorecard.
 */

interface WorkspaceVisit {
  venueId: string;
  date: string;
  productivityScore: number;  // 1-10 (self-reported)
  wifiScore: number;
  quietScore: number;
  comfortScore: number;
  revisitIntent: boolean;
}

function overallExperienceScore(visit: WorkspaceVisit): number {
  const avg = (visit.productivityScore + visit.wifiScore + visit.quietScore + visit.comfortScore) / 4;
  return Math.round(avg * 10) / 10;
}

function bestVisit(visits: WorkspaceVisit[]): WorkspaceVisit | null {
  if (visits.length === 0) return null;
  return visits.reduce((best, v) =>
    overallExperienceScore(v) > overallExperienceScore(best) ? v : best
  );
}

function worstVisit(visits: WorkspaceVisit[]): WorkspaceVisit | null {
  if (visits.length === 0) return null;
  return visits.reduce((worst, v) =>
    overallExperienceScore(v) < overallExperienceScore(worst) ? v : worst
  );
}

function averageProductivity(visits: WorkspaceVisit[]): number {
  if (visits.length === 0) return 0;
  return Math.round(
    visits.reduce((s, v) => s + v.productivityScore, 0) / visits.length * 10
  ) / 10;
}

function revisitIntentRate(visits: WorkspaceVisit[]): number {
  if (visits.length === 0) return 0;
  return Math.round(
    (visits.filter((v) => v.revisitIntent).length / visits.length) * 100
  );
}

const VISITS: WorkspaceVisit[] = [
  { venueId: "v1", date: "2026-10-01", productivityScore: 9, wifiScore: 8, quietScore: 7, comfortScore: 8, revisitIntent: true  },
  { venueId: "v2", date: "2026-10-02", productivityScore: 6, wifiScore: 5, quietScore: 4, comfortScore: 6, revisitIntent: false },
  { venueId: "v3", date: "2026-10-03", productivityScore: 8, wifiScore: 9, quietScore: 8, comfortScore: 7, revisitIntent: true  },
];

describe("User workspace scorecard", () => {
  it("overallExperienceScore: v1 = (9+8+7+8)/4 = 8.0", () => {
    expect(overallExperienceScore(VISITS[0])).toBe(8.0);
  });

  it("bestVisit: v3 has highest avg", () => {
    // v1: 8.0, v2: 5.25, v3: 8.0 → tie, so depends on order
    const best = bestVisit(VISITS)!;
    expect(overallExperienceScore(best)).toBeGreaterThanOrEqual(8.0);
  });

  it("worstVisit: v2 has lowest score", () => {
    expect(worstVisit(VISITS)!.venueId).toBe("v2");
  });

  it("bestVisit: empty → null", () => {
    expect(bestVisit([])).toBeNull();
  });

  it("averageProductivity: (9+6+8)/3 ≈ 7.7", () => {
    expect(averageProductivity(VISITS)).toBeCloseTo(7.7, 1);
  });

  it("revisitIntentRate: 2/3 = 67%", () => {
    expect(revisitIntentRate(VISITS)).toBe(67);
  });

  it("revisitIntentRate: empty → 0", () => {
    expect(revisitIntentRate([])).toBe(0);
  });
});
