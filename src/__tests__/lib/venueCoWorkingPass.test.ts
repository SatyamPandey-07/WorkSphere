/**
 * Tests for co-working day pass management.
 */

type PassType = "day" | "week" | "month";

interface DayPass {
  id: string;
  userId: string;
  type: PassType;
  purchasedAt: number;
  expiresAt: number;
  remainingUses: number;
  maxUses: number;
  priceCents: number;
}

function isPassValid(pass: DayPass, nowMs: number): boolean {
  return nowMs <= pass.expiresAt && pass.remainingUses > 0;
}

function usePass(pass: DayPass): DayPass {
  if (pass.remainingUses <= 0) throw new Error("No uses remaining");
  return { ...pass, remainingUses: pass.remainingUses - 1 };
}

function passUsagePercent(pass: DayPass): number {
  if (pass.maxUses === 0) return 0;
  return Math.round(((pass.maxUses - pass.remainingUses) / pass.maxUses) * 100);
}

function passPricePerUse(pass: DayPass): number {
  if (pass.maxUses === 0) return 0;
  return Math.round(pass.priceCents / pass.maxUses);
}

const NOW = 1_700_000_000_000;
const DAY_PASS: DayPass = {
  id: "p1", userId: "u1", type: "day",
  purchasedAt: NOW - 3600_000, expiresAt: NOW + 72_000_000,
  remainingUses: 3, maxUses: 5, priceCents: 2500,
};

describe("Co-working day pass", () => {
  it("isPassValid: uses remaining and not expired → true", () => {
    expect(isPassValid(DAY_PASS, NOW)).toBe(true);
  });

  it("isPassValid: expired → false", () => {
    expect(isPassValid(DAY_PASS, NOW + 100_000_000)).toBe(false);
  });

  it("isPassValid: no uses remaining → false", () => {
    expect(isPassValid({ ...DAY_PASS, remainingUses: 0 }, NOW)).toBe(false);
  });

  it("usePass decrements remainingUses", () => {
    const used = usePass(DAY_PASS);
    expect(used.remainingUses).toBe(2);
  });

  it("usePass throws when no uses left", () => {
    expect(() => usePass({ ...DAY_PASS, remainingUses: 0 })).toThrow("No uses remaining");
  });

  it("usePass is immutable", () => {
    usePass(DAY_PASS);
    expect(DAY_PASS.remainingUses).toBe(3);
  });

  it("passUsagePercent: 2 of 5 used = 40%", () => {
    expect(passUsagePercent(DAY_PASS)).toBe(40);
  });

  it("passUsagePercent: max uses 0 → 0", () => {
    expect(passUsagePercent({ ...DAY_PASS, maxUses: 0 })).toBe(0);
  });

  it("passPricePerUse: 2500/5 = 500 cents", () => {
    expect(passPricePerUse(DAY_PASS)).toBe(500);
  });
});
