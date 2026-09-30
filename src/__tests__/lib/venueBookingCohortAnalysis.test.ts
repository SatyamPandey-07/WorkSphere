/**
 * Tests for venue booking cohort analysis.
 */

interface UserCohort {
  cohortId: string;
  cohortMonth: string; // YYYY-MM
  users: string[];
  retainedMonth2: string[];
  retainedMonth3: string[];
  avgBookingsPerUser: number;
  avgRevenuePerUserCents: number;
}

function cohortRetentionRate(cohort: UserCohort, month: 2 | 3): number {
  const retained = month === 2 ? cohort.retainedMonth2 : cohort.retainedMonth3;
  if (cohort.users.length === 0) return 0;
  return Math.round((retained.length / cohort.users.length) * 100);
}

function cohortLTV(cohort: UserCohort, months: number): number {
  return cohort.users.length * cohort.avgRevenuePerUserCents * months;
}

function compareCohorts(
  cohorts: UserCohort[]
): { bestRetention: string | null; bestRevenue: string | null } {
  if (cohorts.length === 0) return { bestRetention: null, bestRevenue: null };
  const bestRetention = cohorts.reduce((best, c) =>
    cohortRetentionRate(c, 2) > cohortRetentionRate(best, 2) ? c : best
  ).cohortId;
  const bestRevenue = cohorts.reduce((best, c) =>
    c.avgRevenuePerUserCents > best.avgRevenuePerUserCents ? c : best
  ).cohortId;
  return { bestRetention, bestRevenue };
}

function churnedUsers(cohort: UserCohort): string[] {
  const retained2 = new Set(cohort.retainedMonth2);
  return cohort.users.filter((u) => !retained2.has(u));
}

const COHORTS: UserCohort[] = [
  { cohortId: "c1", cohortMonth: "2026-07", users: ["u1", "u2", "u3", "u4", "u5"],
    retainedMonth2: ["u1", "u2", "u3"], retainedMonth3: ["u1", "u2"],
    avgBookingsPerUser: 3, avgRevenuePerUserCents: 15_000 },
  { cohortId: "c2", cohortMonth: "2026-08", users: ["u6", "u7", "u8"],
    retainedMonth2: ["u6", "u7"], retainedMonth3: ["u6"],
    avgBookingsPerUser: 2, avgRevenuePerUserCents: 20_000 },
];

describe("Venue booking cohort analysis", () => {
  it("cohortRetentionRate: c1 month 2 = 60%", () => {
    expect(cohortRetentionRate(COHORTS[0], 2)).toBe(60);
  });

  it("cohortRetentionRate: c2 month 3 = 33%", () => {
    expect(cohortRetentionRate(COHORTS[1], 3)).toBe(33);
  });

  it("cohortLTV: c1 over 3 months", () => {
    const ltv = cohortLTV(COHORTS[0], 3);
    expect(ltv).toBe(5 * 15_000 * 3); // 225000
  });

  it("compareCohorts: c2 has better retention (67% vs 60%)", () => {
    const { bestRetention } = compareCohorts(COHORTS);
    expect(bestRetention).toBe("c2"); // 67% vs 60%
  });

  it("compareCohorts: c2 has better revenue", () => {
    const { bestRevenue } = compareCohorts(COHORTS);
    expect(bestRevenue).toBe("c2"); // 20000 vs 15000
  });

  it("churnedUsers: c1 = u4, u5 churned", () => {
    const churned = churnedUsers(COHORTS[0]);
    expect(churned).toContain("u4");
    expect(churned).toContain("u5");
    expect(churned).not.toContain("u1");
  });
});
