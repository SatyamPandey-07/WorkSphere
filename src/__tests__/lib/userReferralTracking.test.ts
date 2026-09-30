/**
 * Tests for user referral code tracking and attribution.
 */

interface ReferralCode {
  code: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
}

interface ReferralUse {
  referralCode: string;
  refereeId: string;
  usedAt: number;
  converted: boolean;    // completed first booking
}

function isCodeValid(code: ReferralCode, nowMs: number): boolean {
  if (!code.isActive) return false;
  if (code.expiresAt !== null && nowMs >= code.expiresAt) return false;
  if (code.maxUses !== null && code.usedCount >= code.maxUses) return false;
  return true;
}

function recordReferralUse(code: ReferralCode): ReferralCode {
  if (!code.isActive) throw new Error("Code not active");
  return { ...code, usedCount: code.usedCount + 1 };
}

function conversionRate(uses: ReferralUse[], ownerId: string, code: string): number {
  const relevant = uses.filter((u) => u.referralCode === code);
  if (relevant.length === 0) return 0;
  const converted = relevant.filter((u) => u.converted).length;
  return Math.round((converted / relevant.length) * 100);
}

function totalReferrals(uses: ReferralUse[], ownerId: string): number {
  return uses.filter((u) => {
    // We'd normally join with code ownership, but here we simplify by code prefix
    return uses.some((use) => use.converted);
  }).length;
}

function uniqueReferees(uses: ReferralUse[], code: string): string[] {
  return [...new Set(uses.filter((u) => u.referralCode === code).map((u) => u.refereeId))];
}

const NOW = 1_700_000_000_000;
const CODE: ReferralCode = {
  code: "JASON20", ownerId: "u1", createdAt: NOW - 86_400_000,
  expiresAt: NOW + 30 * 86_400_000, maxUses: 50, usedCount: 10, isActive: true,
};

const USES: ReferralUse[] = [
  { referralCode: "JASON20", refereeId: "u2", usedAt: NOW - 3000, converted: true  },
  { referralCode: "JASON20", refereeId: "u3", usedAt: NOW - 2000, converted: false },
  { referralCode: "JASON20", refereeId: "u4", usedAt: NOW - 1000, converted: true  },
];

describe("User referral tracking", () => {
  it("isCodeValid: active, not expired, has uses left → true", () => {
    expect(isCodeValid(CODE, NOW)).toBe(true);
  });

  it("isCodeValid: inactive → false", () => {
    expect(isCodeValid({ ...CODE, isActive: false }, NOW)).toBe(false);
  });

  it("isCodeValid: expired → false", () => {
    expect(isCodeValid({ ...CODE, expiresAt: NOW - 1 }, NOW)).toBe(false);
  });

  it("isCodeValid: max uses reached → false", () => {
    expect(isCodeValid({ ...CODE, usedCount: 50 }, NOW)).toBe(false);
  });

  it("recordReferralUse: increments usedCount", () => {
    expect(recordReferralUse(CODE).usedCount).toBe(11);
  });

  it("recordReferralUse is immutable", () => {
    recordReferralUse(CODE);
    expect(CODE.usedCount).toBe(10);
  });

  it("conversionRate: 2/3 = 67%", () => {
    expect(conversionRate(USES, "u1", "JASON20")).toBe(67);
  });

  it("uniqueReferees: 3 unique", () => {
    expect(uniqueReferees(USES, "JASON20")).toHaveLength(3);
  });
});
