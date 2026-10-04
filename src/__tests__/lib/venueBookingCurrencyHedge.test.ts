/**
 * Tests for venue booking currency hedging and foreign exchange risk management.
 */

interface ForwardContract {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  contractRate: number;
  settlementDate: number;
  currentSpotRate: number;
}

function forwardPremium(contract: ForwardContract): number {
  return Math.round((contract.contractRate - contract.currentSpotRate) / contract.currentSpotRate * 10000) / 100;
}

function hedgedAmount(contract: ForwardContract): number {
  return Math.round(contract.amount * contract.contractRate * 100) / 100;
}

function spotAmount(contract: ForwardContract): number {
  return Math.round(contract.amount * contract.currentSpotRate * 100) / 100;
}

function hedgingBenefit(contract: ForwardContract): number {
  return Math.round((hedgedAmount(contract) - spotAmount(contract)) * 100) / 100;
}

function daysToSettlement(contract: ForwardContract, nowMs: number): number {
  return Math.max(0, Math.floor((contract.settlementDate - nowMs) / 86_400_000));
}

function isHedgeFavourable(contract: ForwardContract): boolean {
  return hedgedAmount(contract) > spotAmount(contract);
}

const NOW = 1_700_000_000_000;
const CONTRACT: ForwardContract = {
  id: "fwd-001",
  fromCurrency: "EUR", toCurrency: "USD",
  amount: 10000,
  contractRate: 1.12,
  settlementDate: NOW + 30 * 86_400_000,
  currentSpotRate: 1.08,
};

describe("Currency hedging and FX risk management", () => {
  it("hedgedAmount: 10000 EUR × 1.12 = $11200", () => {
    expect(hedgedAmount(CONTRACT)).toBe(11200);
  });

  it("spotAmount: 10000 EUR × 1.08 = $10800", () => {
    expect(spotAmount(CONTRACT)).toBe(10800);
  });

  it("hedgingBenefit: $11200 - $10800 = $400 benefit", () => {
    expect(hedgingBenefit(CONTRACT)).toBe(400);
  });

  it("isHedgeFavourable: contract rate higher than spot → true", () => {
    expect(isHedgeFavourable(CONTRACT)).toBe(true);
  });

  it("daysToSettlement: 30 days", () => {
    expect(daysToSettlement(CONTRACT, NOW)).toBe(30);
  });

  it("forwardPremium: (1.12-1.08)/1.08 ≈ 3.7%", () => {
    expect(forwardPremium(CONTRACT)).toBeGreaterThan(3);
    expect(forwardPremium(CONTRACT)).toBeLessThan(5);
  });
});
