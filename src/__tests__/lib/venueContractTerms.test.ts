/**
 * Tests for venue long-term contract terms and penalty calculation.
 */

type ContractLength = "monthly" | "quarterly" | "biannual" | "annual";

interface ContractTerms {
  contractId: string;
  venueId: string;
  userId: string;
  length: ContractLength;
  startDate: string;
  endDate: string;
  monthlyRentCents: number;
  earlyTerminationFeeMonths: number; // months of rent as penalty
  noticePeriodDays: number;
}

const CONTRACT_MONTHS: Record<ContractLength, number> = {
  monthly: 1, quarterly: 3, biannual: 6, annual: 12,
};

function totalContractValue(terms: ContractTerms): number {
  const months = CONTRACT_MONTHS[terms.length];
  return terms.monthlyRentCents * months;
}

function earlyTerminationFee(terms: ContractTerms): number {
  return terms.monthlyRentCents * terms.earlyTerminationFeeMonths;
}

function isWithinNoticePeriod(
  terms: ContractTerms,
  terminationDate: string,
  nowStr: string
): boolean {
  const now = new Date(nowStr).getTime();
  const termination = new Date(terminationDate).getTime();
  const noticeDaysMs = terms.noticePeriodDays * 86_400_000;
  return termination - now < noticeDaysMs;
}

function remainingMonths(terms: ContractTerms, nowStr: string): number {
  const now = new Date(nowStr).getTime();
  const end = new Date(terms.endDate).getTime();
  const diff = end - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (30 * 86_400_000));
}

const TERMS: ContractTerms = {
  contractId: "c1", venueId: "v1", userId: "u1",
  length: "annual", startDate: "2026-01-01", endDate: "2026-12-31",
  monthlyRentCents: 50_000, earlyTerminationFeeMonths: 2,
  noticePeriodDays: 30,
};

describe("Venue contract terms", () => {
  it("totalContractValue: annual = 12 months × 50000 = 600000", () => {
    expect(totalContractValue(TERMS)).toBe(600_000);
  });

  it("earlyTerminationFee: 2 months × 50000 = 100000", () => {
    expect(earlyTerminationFee(TERMS)).toBe(100_000);
  });

  it("totalContractValue: quarterly = 3 months", () => {
    const quarterly = { ...TERMS, length: "quarterly" as ContractLength };
    expect(totalContractValue(quarterly)).toBe(150_000);
  });

  it("isWithinNoticePeriod: 15 days from now → true", () => {
    const now = new Date("2026-10-01").toISOString().split("T")[0];
    const termination = new Date("2026-10-16").toISOString().split("T")[0];
    expect(isWithinNoticePeriod(TERMS, termination, now)).toBe(true);
  });

  it("isWithinNoticePeriod: 45 days from now → false", () => {
    const now = new Date("2026-10-01").toISOString().split("T")[0];
    const termination = new Date("2026-11-15").toISOString().split("T")[0];
    expect(isWithinNoticePeriod(TERMS, termination, now)).toBe(false);
  });

  it("remainingMonths: from mid-contract", () => {
    const months = remainingMonths(TERMS, "2026-10-01");
    expect(months).toBeGreaterThan(0);
  });

  it("remainingMonths: past end date → 0", () => {
    expect(remainingMonths(TERMS, "2027-01-01")).toBe(0);
  });
});
