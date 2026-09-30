/**
 * Tests for loyalty program enrollment and tier tracking.
 */

interface LoyaltyProgram {
  programId: string;
  venueId: string;
  name: string;
  tiers: { tier: string; minPoints: number; benefits: string[] }[];
  pointsPerDollar: number;
  welcomeBonus: number;
}

interface UserEnrollment {
  enrollmentId: string;
  userId: string;
  programId: string;
  enrolledAt: number;
  currentPoints: number;
  lifetimePoints: number;
  currentTier: string;
  welcomeBonusClaimed: boolean;
}

function getCurrentTier(enrollment: UserEnrollment, program: LoyaltyProgram): string {
  const sorted = [...program.tiers].sort((a, b) => b.minPoints - a.minPoints);
  for (const tier of sorted) {
    if (enrollment.lifetimePoints >= tier.minPoints) return tier.tier;
  }
  return program.tiers[0]?.tier ?? "none";
}

function earnPointsFromBooking(enrollment: UserEnrollment, bookingValueCents: number, program: LoyaltyProgram): UserEnrollment {
  const earned = Math.floor((bookingValueCents / 100) * program.pointsPerDollar);
  const newCurrent = enrollment.currentPoints + earned;
  const newLifetime = enrollment.lifetimePoints + earned;
  return {
    ...enrollment,
    currentPoints: newCurrent,
    lifetimePoints: newLifetime,
    currentTier: getCurrentTier({ ...enrollment, lifetimePoints: newLifetime }, program),
  };
}

function claimWelcomeBonus(enrollment: UserEnrollment, program: LoyaltyProgram): UserEnrollment {
  if (enrollment.welcomeBonusClaimed) return enrollment;
  return {
    ...enrollment,
    currentPoints: enrollment.currentPoints + program.welcomeBonus,
    welcomeBonusClaimed: true,
  };
}

function nextTierProgress(enrollment: UserEnrollment, program: LoyaltyProgram): { nextTier: string; pointsNeeded: number } | null {
  const currentIdx = program.tiers.findIndex((t) => t.tier === enrollment.currentTier);
  if (currentIdx === -1 || currentIdx === program.tiers.length - 1) return null;
  const next = program.tiers[currentIdx + 1];
  return { nextTier: next.tier, pointsNeeded: Math.max(0, next.minPoints - enrollment.lifetimePoints) };
}

const PROGRAM: LoyaltyProgram = {
  programId: "lp1", venueId: "v1", name: "WorkSphere Rewards",
  tiers: [
    { tier: "Member",   minPoints: 0,    benefits: ["5% off"]     },
    { tier: "Silver",   minPoints: 500,  benefits: ["10% off"]    },
    { tier: "Gold",     minPoints: 2000, benefits: ["15% off"]    },
    { tier: "Platinum", minPoints: 5000, benefits: ["20% off", "priority"] },
  ],
  pointsPerDollar: 10,
  welcomeBonus: 100,
};

const ENROLLMENT: UserEnrollment = {
  enrollmentId: "e1", userId: "u1", programId: "lp1",
  enrolledAt: 1_700_000_000_000, currentPoints: 300, lifetimePoints: 300,
  currentTier: "Member", welcomeBonusClaimed: false,
};

describe("Loyalty program enrollment", () => {
  it("getCurrentTier: 300 points = Member tier", () => {
    expect(getCurrentTier(ENROLLMENT, PROGRAM)).toBe("Member");
  });

  it("earnPointsFromBooking: $50 booking × 10pts/$ = 500 pts", () => {
    const updated = earnPointsFromBooking(ENROLLMENT, 5000, PROGRAM);
    expect(updated.currentPoints).toBe(800);
    expect(updated.lifetimePoints).toBe(800);
  });

  it("earnPointsFromBooking: upgrades tier when threshold met", () => {
    const updated = earnPointsFromBooking(ENROLLMENT, 20000, PROGRAM); // +2000 pts → 2300 total
    expect(updated.currentTier).toBe("Gold");
  });

  it("claimWelcomeBonus: adds bonus points", () => {
    const updated = claimWelcomeBonus(ENROLLMENT, PROGRAM);
    expect(updated.currentPoints).toBe(400);
    expect(updated.welcomeBonusClaimed).toBe(true);
  });

  it("claimWelcomeBonus: already claimed → no change", () => {
    const claimed = { ...ENROLLMENT, welcomeBonusClaimed: true };
    expect(claimWelcomeBonus(claimed, PROGRAM).currentPoints).toBe(ENROLLMENT.currentPoints);
  });

  it("nextTierProgress: Member needs 200 more for Silver", () => {
    const progress = nextTierProgress(ENROLLMENT, PROGRAM);
    expect(progress!.nextTier).toBe("Silver");
    expect(progress!.pointsNeeded).toBe(200);
  });
});
