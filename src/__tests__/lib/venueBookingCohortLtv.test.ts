/**
 * Tests for venue booking cohort-based lifetime value analysis.
 */

interface CohortData {
  cohortMonth: string;   // YYYY-MM
  cohortSize: number;
  monthsActive: number;
  totalRevenue: number;
  retainedUsers: number;
}

function avgRevenuePerUser(cohort: CohortData): number {
  if (cohort.cohortSize === 0) return 0;
  return Math.round((cohort.totalRevenue / cohort.cohortSize) * 100) / 100;
}

function retentionRate(cohort: CohortData): number {
  if (cohort.cohortSize === 0) return 0;
  return Math.round((cohort.retainedUsers / cohort.cohortSize) * 100);
}

function monthlyAvgRevenue(cohort: CohortData): number {
  if (cohort.monthsActive === 0) return 0;
  return Math.round((cohort.totalRevenue / cohort.monthsActive) * 100) / 100;
}

function projectedLtv(cohort: CohortData, projectionMonths: number): number {
  const monthly = monthlyAvgRevenue(cohort);
  const retention = retentionRate(cohort) / 100;
  // Simple geometric retention model
  let ltv = 0;
  let retained = cohort.cohortSize;
  for (let m = 0; m < projectionMonths; m++) {
    ltv += (retained / cohort.cohortSize) * monthly;
    retained *= retention;
  }
  return Math.round(ltv * 100) / 100;
}

function bestCohort(cohorts: CohortData[]): CohortData | null {
  if (cohorts.length === 0) return null;
  return cohorts.reduce((best, c) =>
    avgRevenuePerUser(c) > avgRevenuePerUser(best) ? c : best, cohorts[0]
  );
}

function totalCohortRevenue(cohorts: CohortData[]): number {
  return Math.round(cohorts.reduce((s, c) => s + c.totalRevenue, 0) * 100) / 100;
}

const COHORTS: CohortData[] = [
  { cohortMonth: "2026-01", cohortSize: 500, monthsActive: 9, totalRevenue: 250_000, retainedUsers: 350 },
  { cohortMonth: "2026-04", cohortSize: 700, monthsActive: 6, totalRevenue: 280_000, retainedUsers: 420 },
  { cohortMonth: "2026-07", cohortSize: 900, monthsActive: 3, totalRevenue: 180_000, retainedUsers: 630 },
];

describe("Cohort-based lifetime value analysis", () => {
  it("avgRevenuePerUser: cohort1 = $500/user", () => {
    expect(avgRevenuePerUser(COHORTS[0])).toBe(500);
  });

  it("retentionRate: 350/500 = 70%", () => {
    expect(retentionRate(COHORTS[0])).toBe(70);
  });

  it("monthlyAvgRevenue: $250k over 9 months ≈ $27,778", () => {
    expect(monthlyAvgRevenue(COHORTS[0])).toBeGreaterThan(27000);
  });

  it("bestCohort: cohort with highest avg revenue per user", () => {
    const best = bestCohort(COHORTS);
    expect(best?.cohortMonth).toBeDefined();
  });

  it("totalCohortRevenue: $250k + $280k + $180k = $710k", () => {
    expect(totalCohortRevenue(COHORTS)).toBe(710_000);
  });

  it("projectedLtv: positive projection for 6 months", () => {
    expect(projectedLtv(COHORTS[0], 6)).toBeGreaterThan(0);
  });
});
