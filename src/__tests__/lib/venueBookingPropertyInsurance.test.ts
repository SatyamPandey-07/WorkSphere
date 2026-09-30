/**
 * Tests for venue property insurance and liability calculations.
 */

interface InsuranceCoverage {
  venueId: string;
  propertyValue: number;
  liabilityCap: number;
  annualPremium: number;
  deductible: number;
  coverageTypes: ("property" | "liability" | "business_interruption" | "equipment")[];
}

interface InsuranceClaim {
  id: string;
  venueId: string;
  type: "property" | "liability" | "equipment";
  claimedAmount: number;
  approvedAmount: number | null;
  status: "pending" | "approved" | "rejected" | "paid";
  incidentAt: number;
  filedAt: number;
}

function isFullyCovered(coverage: InsuranceCoverage, claimType: InsuranceClaim["type"]): boolean {
  return coverage.coverageTypes.includes(claimType);
}

function netPayoutAfterDeductible(coverage: InsuranceCoverage, approvedAmount: number): number {
  return Math.max(0, approvedAmount - coverage.deductible);
}

function claimFilingDelayDays(claim: InsuranceClaim): number {
  return Math.floor((claim.filedAt - claim.incidentAt) / 86_400_000);
}

function totalApprovedPayout(claims: InsuranceClaim[]): number {
  return Math.round(
    claims
      .filter((c) => c.status === "approved" || c.status === "paid")
      .reduce((s, c) => s + (c.approvedAmount ?? 0), 0) * 100
  ) / 100;
}

function premiumToValueRatio(coverage: InsuranceCoverage): number {
  if (coverage.propertyValue === 0) return 0;
  return Math.round((coverage.annualPremium / coverage.propertyValue) * 10000) / 10000;
}

function pendingClaimsValue(claims: InsuranceClaim[]): number {
  return Math.round(claims.filter((c) => c.status === "pending").reduce((s, c) => s + c.claimedAmount, 0) * 100) / 100;
}

const COVERAGE: InsuranceCoverage = {
  venueId: "v1", propertyValue: 2_000_000, liabilityCap: 5_000_000,
  annualPremium: 15_000, deductible: 2_500,
  coverageTypes: ["property", "liability", "equipment"],
};

const CLAIMS: InsuranceClaim[] = [
  { id: "c1", venueId: "v1", type: "property", claimedAmount: 30_000, approvedAmount: 28_000, status: "paid",    incidentAt: 1_700_000_000_000, filedAt: 1_700_000_000_000 + 2 * 86_400_000 },
  { id: "c2", venueId: "v1", type: "equipment",claimedAmount: 5_000,  approvedAmount: null,   status: "pending", incidentAt: 1_700_000_000_000, filedAt: 1_700_000_000_000 + 86_400_000 },
];

describe("Property insurance calculations", () => {
  it("isFullyCovered: equipment is in coverage types → true", () => {
    expect(isFullyCovered(COVERAGE, "equipment")).toBe(true);
  });

  it("isFullyCovered: business_interruption not included → false", () => {
    expect(isFullyCovered(COVERAGE, "business_interruption" as any)).toBe(false);
  });

  it("netPayoutAfterDeductible: $28000 - $2500 = $25500", () => {
    expect(netPayoutAfterDeductible(COVERAGE, 28_000)).toBe(25_500);
  });

  it("claimFilingDelayDays: filed 2 days after incident", () => {
    expect(claimFilingDelayDays(CLAIMS[0])).toBe(2);
  });

  it("totalApprovedPayout: only paid claim c1 = $28000", () => {
    expect(totalApprovedPayout(CLAIMS)).toBe(28_000);
  });

  it("pendingClaimsValue: $5000 pending", () => {
    expect(pendingClaimsValue(CLAIMS)).toBe(5_000);
  });
});
