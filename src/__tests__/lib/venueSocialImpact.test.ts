/**
 * Tests for venue social impact and community contribution metrics.
 */

interface SocialImpactMetrics {
  venueId: string;
  localJobsSupported: number;
  communityEventsPerMonth: number;
  nonprofitPartnerships: number;
  accessibleSpaces: number;
  totalSpaces: number;
  discountedRatesOffered: boolean;
  mentoringPrograms: boolean;
}

function accessibilityRatio(metrics: SocialImpactMetrics): number {
  if (metrics.totalSpaces === 0) return 0;
  return Math.round((metrics.accessibleSpaces / metrics.totalSpaces) * 100);
}

function socialImpactScore(metrics: SocialImpactMetrics): number {
  let score = 0;
  score += Math.min(metrics.localJobsSupported * 5, 25);
  score += Math.min(metrics.communityEventsPerMonth * 3, 15);
  score += Math.min(metrics.nonprofitPartnerships * 8, 24);
  score += Math.min(accessibilityRatio(metrics), 20);
  if (metrics.discountedRatesOffered) score += 8;
  if (metrics.mentoringPrograms) score += 8;
  return Math.min(score, 100);
}

function socialImpactLabel(score: number): "minimal" | "moderate" | "high" | "exceptional" {
  if (score >= 75) return "exceptional";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "minimal";
}

const HIGH_IMPACT: SocialImpactMetrics = {
  venueId: "v1", localJobsSupported: 5, communityEventsPerMonth: 4,
  nonprofitPartnerships: 3, accessibleSpaces: 10, totalSpaces: 10,
  discountedRatesOffered: true, mentoringPrograms: true,
};

const LOW_IMPACT: SocialImpactMetrics = {
  venueId: "v2", localJobsSupported: 0, communityEventsPerMonth: 0,
  nonprofitPartnerships: 0, accessibleSpaces: 0, totalSpaces: 10,
  discountedRatesOffered: false, mentoringPrograms: false,
};

describe("Venue social impact metrics", () => {
  it("accessibilityRatio: 10/10 = 100%", () => {
    expect(accessibilityRatio(HIGH_IMPACT)).toBe(100);
  });

  it("accessibilityRatio: 0 spaces → 0", () => {
    expect(accessibilityRatio(LOW_IMPACT)).toBe(0);
  });

  it("socialImpactScore: high impact → high score", () => {
    expect(socialImpactScore(HIGH_IMPACT)).toBeGreaterThan(70);
  });

  it("socialImpactScore: low impact → 0", () => {
    expect(socialImpactScore(LOW_IMPACT)).toBe(0);
  });

  it("socialImpactScore: capped at 100", () => {
    expect(socialImpactScore(HIGH_IMPACT)).toBeLessThanOrEqual(100);
  });

  it("socialImpactLabel: high score → exceptional", () => {
    expect(socialImpactLabel(socialImpactScore(HIGH_IMPACT))).toBe("exceptional");
  });

  it("socialImpactLabel: 0 score → minimal", () => {
    expect(socialImpactLabel(0)).toBe("minimal");
  });

  it("bonuses add to score: discounted rates adds 8", () => {
    const noBonus = socialImpactScore({ ...HIGH_IMPACT, discountedRatesOffered: false, mentoringPrograms: false });
    const withBonus = socialImpactScore({ ...HIGH_IMPACT, discountedRatesOffered: true, mentoringPrograms: false });
    expect(withBonus - noBonus).toBe(8);
  });
});
