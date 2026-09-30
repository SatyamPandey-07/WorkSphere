/**
 * Tests for venue booking cohort retention analysis.
 */

interface CohortRetentionData {
  cohortMonth: string;   // YYYY-MM
  initialUsers: number;
  retentionByMonth: number[];  // retention count at month 1, 2, 3...
}

function retentionRate(data: CohortRetentionData, month: number): number {
  if (data.initialUsers === 0 || month <= 0 || month > data.retentionByMonth.length) return 0;
  return Math.round((data.retentionByMonth[month - 1] / data.initialUsers) * 100);
}

function cumulativeRetention(data: CohortRetentionData, months: number): number[] {
  return Array.from({ length: Math.min(months, data.retentionByMonth.length) }, (_, i) =>
    retentionRate(data, i + 1)
  );
}

function avgRetentionAt(cohorts: CohortRetentionData[], month: number): number {
  const rates = cohorts
    .filter((c) => c.retentionByMonth.length >= month)
    .map((c) => retentionRate(c, month));
  if (rates.length === 0) return 0;
  return Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);
}

function bestRetainingCohort(cohorts: CohortRetentionData[], month: number): string | null {
  const eligible = cohorts.filter((c) => c.retentionByMonth.length >= month);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) =>
    retentionRate(c, month) > retentionRate(best, month) ? c : best
  ).cohortMonth;
}

function churnRate(data: CohortRetentionData, month: number): number {
  if (month <= 1) return 100 - retentionRate(data, 1);
  return retentionRate(data, month - 1) - retentionRate(data, month);
}

const COHORTS: CohortRetentionData[] = [
  { cohortMonth: "2026-07", initialUsers: 100, retentionByMonth: [80, 65, 55, 48, 42] },
  { cohortMonth: "2026-08", initialUsers: 120, retentionByMonth: [85, 72, 60, 52] },
  { cohortMonth: "2026-09", initialUsers: 90,  retentionByMonth: [78, 60, 50] },
];

describe("Venue booking cohort retention analysis", () => {
  it("retentionRate: 2026-07 month 1 = 80%", () => {
    expect(retentionRate(COHORTS[0], 1)).toBe(80);
  });

  it("retentionRate: month beyond data → 0", () => {
    expect(retentionRate(COHORTS[0], 10)).toBe(0);
  });

  it("cumulativeRetention: 3 months of rates", () => {
    const rates = cumulativeRetention(COHORTS[0], 3);
    expect(rates).toEqual([80, 65, 55]);
  });

  it("avgRetentionAt: month 3 avg = (55+60+50)/3 ≈ 55", () => {
    expect(avgRetentionAt(COHORTS, 3)).toBe(55);
  });

  it("bestRetainingCohort: 2026-08 best at month 2 (72%)", () => {
    expect(bestRetainingCohort(COHORTS, 2)).toBe("2026-08");
  });

  it("churnRate: month 2 churn = 80-65 = 15%", () => {
    expect(churnRate(COHORTS[0], 2)).toBe(15);
  });

  it("churnRate: month 1 churn = 100-80 = 20%", () => {
    expect(churnRate(COHORTS[0], 1)).toBe(20);
  });
});
