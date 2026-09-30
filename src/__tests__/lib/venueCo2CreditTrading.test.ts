/**
 * Tests for venue CO2 credit trading and environmental marketplace.
 */

interface Co2CreditBalance {
  venueId: string;
  earnedCredits: number;        // metric tons CO2 offset
  tradedCredits: number;        // sold to others
  purchasedCredits: number;     // bought from others
  verifiedAt: number | null;
  certificationLevel: "bronze" | "silver" | "gold" | null;
}

function availableCredits(balance: Co2CreditBalance): number {
  return Math.max(0, balance.earnedCredits + balance.purchasedCredits - balance.tradedCredits);
}

function tradeCredits(
  balance: Co2CreditBalance,
  amount: number
): Co2CreditBalance {
  if (amount <= 0) throw new Error("Trade amount must be positive");
  if (amount > availableCredits(balance)) throw new Error("Insufficient credits");
  return { ...balance, tradedCredits: balance.tradedCredits + amount };
}

function purchaseCredits(balance: Co2CreditBalance, amount: number): Co2CreditBalance {
  if (amount <= 0) throw new Error("Purchase amount must be positive");
  return { ...balance, purchasedCredits: balance.purchasedCredits + amount };
}

function certificationEligible(balance: Co2CreditBalance): boolean {
  return availableCredits(balance) >= 10 && balance.verifiedAt !== null;
}

function assignCertification(balance: Co2CreditBalance): Co2CreditBalance {
  const credits = availableCredits(balance);
  const level = credits >= 100 ? "gold" : credits >= 50 ? "silver" : credits >= 10 ? "bronze" : null;
  return { ...balance, certificationLevel: level };
}

const BALANCE: Co2CreditBalance = {
  venueId: "v1", earnedCredits: 50, tradedCredits: 10, purchasedCredits: 5,
  verifiedAt: 1_700_000_000_000, certificationLevel: "bronze",
};

describe("Venue CO2 credit trading", () => {
  it("availableCredits: 50 + 5 - 10 = 45", () => {
    expect(availableCredits(BALANCE)).toBe(45);
  });

  it("tradeCredits: reduces available", () => {
    const updated = tradeCredits(BALANCE, 10);
    expect(availableCredits(updated)).toBe(35);
  });

  it("tradeCredits: throws when insufficient", () => {
    expect(() => tradeCredits(BALANCE, 50)).toThrow("Insufficient");
  });

  it("tradeCredits: throws on non-positive amount", () => {
    expect(() => tradeCredits(BALANCE, 0)).toThrow("must be positive");
  });

  it("purchaseCredits: increases available", () => {
    const updated = purchaseCredits(BALANCE, 20);
    expect(availableCredits(updated)).toBe(65);
  });

  it("certificationEligible: 45 credits + verified → true", () => {
    expect(certificationEligible(BALANCE)).toBe(true);
  });

  it("certificationEligible: not verified → false", () => {
    expect(certificationEligible({ ...BALANCE, verifiedAt: null })).toBe(false);
  });

  it("assignCertification: 45 credits → bronze", () => {
    expect(assignCertification(BALANCE).certificationLevel).toBe("bronze");
  });

  it("assignCertification: 60 credits → silver", () => {
    const big = { ...BALANCE, earnedCredits: 65 };
    expect(assignCertification(big).certificationLevel).toBe("silver");
  });
});
