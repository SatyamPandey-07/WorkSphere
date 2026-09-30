/**
 * Tests for user workspace credit balance and deduction logic.
 */

interface CreditAccount {
  userId: string;
  balanceCents: number;
  earnedLifetimeCents: number;
  spentLifetimeCents: number;
}

function canAfford(account: CreditAccount, costCents: number): boolean {
  return account.balanceCents >= costCents;
}

function deductCredits(account: CreditAccount, costCents: number): CreditAccount {
  if (!canAfford(account, costCents)) throw new Error("Insufficient credits");
  return {
    ...account,
    balanceCents: account.balanceCents - costCents,
    spentLifetimeCents: account.spentLifetimeCents + costCents,
  };
}

function addCredits(account: CreditAccount, amountCents: number): CreditAccount {
  return {
    ...account,
    balanceCents: account.balanceCents + amountCents,
    earnedLifetimeCents: account.earnedLifetimeCents + amountCents,
  };
}

function netBalance(account: CreditAccount): number {
  return account.earnedLifetimeCents - account.spentLifetimeCents;
}

const BASE_ACCOUNT: CreditAccount = {
  userId: "u1", balanceCents: 5000, earnedLifetimeCents: 10000, spentLifetimeCents: 5000,
};

describe("Credit balance management", () => {
  it("canAfford: enough credits → true", () => {
    expect(canAfford(BASE_ACCOUNT, 4000)).toBe(true);
  });

  it("canAfford: exact balance → true", () => {
    expect(canAfford(BASE_ACCOUNT, 5000)).toBe(true);
  });

  it("canAfford: over balance → false", () => {
    expect(canAfford(BASE_ACCOUNT, 5001)).toBe(false);
  });

  it("deductCredits reduces balance", () => {
    const updated = deductCredits(BASE_ACCOUNT, 1000);
    expect(updated.balanceCents).toBe(4000);
  });

  it("deductCredits increases spentLifetime", () => {
    const updated = deductCredits(BASE_ACCOUNT, 1000);
    expect(updated.spentLifetimeCents).toBe(6000);
  });

  it("deductCredits throws on insufficient funds", () => {
    expect(() => deductCredits(BASE_ACCOUNT, 6000)).toThrow("Insufficient");
  });

  it("deductCredits is immutable", () => {
    deductCredits(BASE_ACCOUNT, 500);
    expect(BASE_ACCOUNT.balanceCents).toBe(5000);
  });

  it("addCredits increases balance and earnedLifetime", () => {
    const updated = addCredits(BASE_ACCOUNT, 2000);
    expect(updated.balanceCents).toBe(7000);
    expect(updated.earnedLifetimeCents).toBe(12000);
  });

  it("netBalance = earned - spent", () => {
    expect(netBalance(BASE_ACCOUNT)).toBe(5000);
  });
});
