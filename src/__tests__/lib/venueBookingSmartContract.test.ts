/**
 * Tests for venue booking smart contract rule evaluation.
 */

interface ContractClause {
  id: string;
  type: "payment" | "cancellation" | "force_majeure" | "liability" | "ip_rights" | "confidentiality";
  condition: string;
  penalty: number;       // flat amount
  penaltyPercent: number;// % of contract value (0 if not applicable)
  isOptional: boolean;
}

interface SmartContractState {
  contractId: string;
  value: number;
  status: "draft" | "active" | "breached" | "fulfilled" | "terminated";
  clauses: ContractClause[];
  paidAmount: number;
  breachDetails: string | null;
}

function clausesByType(contract: SmartContractState, type: ContractClause["type"]): ContractClause[] {
  return contract.clauses.filter((c) => c.type === type);
}

function maxPenalty(contract: SmartContractState): number {
  let max = 0;
  for (const clause of contract.clauses) {
    const p = Math.max(clause.penalty, (contract.value * clause.penaltyPercent) / 100);
    if (p > max) max = p;
  }
  return Math.round(max * 100) / 100;
}

function outstandingBalance(contract: SmartContractState): number {
  return Math.max(0, Math.round((contract.value - contract.paidAmount) * 100) / 100);
}

function isFullyPaid(contract: SmartContractState): boolean {
  return contract.paidAmount >= contract.value;
}

function mandatoryClauses(contract: SmartContractState): ContractClause[] {
  return contract.clauses.filter((c) => !c.isOptional);
}

function contractRiskLevel(contract: SmartContractState): "low" | "medium" | "high" {
  const penalty = maxPenalty(contract);
  const ratio = penalty / contract.value;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.2) return "medium";
  return "low";
}

const CONTRACT: SmartContractState = {
  contractId: "sc-001", value: 10_000, status: "active", paidAmount: 3000, breachDetails: null,
  clauses: [
    { id: "c1", type: "payment",      condition: "Pay within 30 days", penalty: 500,  penaltyPercent: 5, isOptional: false },
    { id: "c2", type: "cancellation", condition: "14 days notice",     penalty: 0,    penaltyPercent: 25,isOptional: false },
    { id: "c3", type: "ip_rights",    condition: "Venue retains rights",penalty: 0,   penaltyPercent: 0, isOptional: true },
  ],
};

describe("Smart contract rule evaluation", () => {
  it("clausesByType: 1 payment clause", () => {
    expect(clausesByType(CONTRACT, "payment").length).toBe(1);
  });

  it("maxPenalty: cancellation 25% of $10k = $2500", () => {
    expect(maxPenalty(CONTRACT)).toBe(2500);
  });

  it("outstandingBalance: $10000 - $3000 = $7000", () => {
    expect(outstandingBalance(CONTRACT)).toBe(7000);
  });

  it("isFullyPaid: $3000 of $10000 → false", () => {
    expect(isFullyPaid(CONTRACT)).toBe(false);
  });

  it("mandatoryClauses: 2 non-optional clauses", () => {
    expect(mandatoryClauses(CONTRACT).length).toBe(2);
  });

  it("contractRiskLevel: 25% penalty → medium", () => {
    expect(contractRiskLevel(CONTRACT)).toBe("medium");
  });
});
