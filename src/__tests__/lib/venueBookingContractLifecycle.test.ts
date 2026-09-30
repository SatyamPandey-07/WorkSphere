/**
 * Tests for venue booking contract lifecycle management.
 */

type ContractStatus = "draft" | "sent" | "negotiating" | "signed" | "active" | "completed" | "cancelled" | "expired";

interface Contract {
  id: string;
  venueId: string;
  organizerId: string;
  status: ContractStatus;
  createdAt: number;
  expiresAt: number;
  value: number;
  amendmentCount: number;
}

const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft:       ["sent", "cancelled"],
  sent:        ["negotiating", "signed", "expired", "cancelled"],
  negotiating: ["signed", "cancelled"],
  signed:      ["active", "cancelled"],
  active:      ["completed", "cancelled"],
  completed:   [],
  cancelled:   [],
  expired:     [],
};

function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function contractAge(contract: Contract, nowMs: number): number {
  return Math.floor((nowMs - contract.createdAt) / 86_400_000);
}

function isExpired(contract: Contract, nowMs: number): boolean {
  return contract.status !== "completed" &&
    contract.status !== "cancelled" &&
    nowMs > contract.expiresAt;
}

function totalContractValue(contracts: Contract[]): number {
  return contracts
    .filter((c) => c.status !== "cancelled" && c.status !== "expired")
    .reduce((s, c) => s + c.value, 0);
}

function highAmendmentContracts(contracts: Contract[], threshold = 3): Contract[] {
  return contracts.filter((c) => c.amendmentCount > threshold);
}

const NOW = 1_700_000_000_000;
const BASE: Contract = {
  id: "c1", venueId: "v1", organizerId: "org1",
  status: "draft", createdAt: NOW - 5 * 86_400_000,
  expiresAt: NOW + 10 * 86_400_000, value: 5000, amendmentCount: 0,
};

describe("Venue booking contract lifecycle", () => {
  it("canTransition: draft → sent is valid", () => {
    expect(canTransition("draft", "sent")).toBe(true);
  });

  it("canTransition: completed → active is invalid", () => {
    expect(canTransition("completed", "active")).toBe(false);
  });

  it("contractAge: 5-day-old contract", () => {
    expect(contractAge(BASE, NOW)).toBe(5);
  });

  it("isExpired: future expiry → false", () => {
    expect(isExpired(BASE, NOW)).toBe(false);
  });

  it("isExpired: past expiry → true", () => {
    const expired = { ...BASE, status: "sent" as ContractStatus, expiresAt: NOW - 1000 };
    expect(isExpired(expired, NOW)).toBe(true);
  });

  it("totalContractValue: excludes cancelled contracts", () => {
    const list: Contract[] = [
      { ...BASE, id: "c1", value: 2000, status: "active" },
      { ...BASE, id: "c2", value: 3000, status: "cancelled" },
      { ...BASE, id: "c3", value: 1500, status: "completed" },
    ];
    expect(totalContractValue(list)).toBe(3500);
  });

  it("highAmendmentContracts: returns over-threshold contracts", () => {
    const list: Contract[] = [
      { ...BASE, id: "c1", amendmentCount: 5 },
      { ...BASE, id: "c2", amendmentCount: 1 },
    ];
    expect(highAmendmentContracts(list).length).toBe(1);
  });
});
