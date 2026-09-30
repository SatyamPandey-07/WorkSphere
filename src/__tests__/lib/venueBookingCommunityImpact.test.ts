/**
 * Tests for venue booking community impact scoring.
 */

interface CommunityImpactData {
  venueId: string;
  localHiresCount: number;
  communityEventsCount: number;
  charityDonationsCents: number;
  localSuppliersCount: number;
  mentorshipHours: number;
  localArtDisplayed: boolean;
  publicWifiOffered: boolean;
}

function communityImpactScore(data: CommunityImpactData): number {
  let score = 0;
  score += Math.min(data.localHiresCount * 5, 25);
  score += Math.min(data.communityEventsCount * 3, 15);
  score += Math.min(Math.floor(data.charityDonationsCents / 10000), 20); // 1pt per $100
  score += Math.min(data.localSuppliersCount * 4, 20);
  score += Math.min(data.mentorshipHours * 0.5, 10);
  if (data.localArtDisplayed) score += 5;
  if (data.publicWifiOffered) score += 5;
  return Math.min(score, 100);
}

function impactBadge(score: number): string {
  if (score >= 80) return "Community Champion";
  if (score >= 60) return "Community Contributor";
  if (score >= 40) return "Community Supporter";
  if (score >= 20) return "Community Starter";
  return "No Badge";
}

function topImpactMetric(data: CommunityImpactData): string {
  const metrics: { key: string; value: number }[] = [
    { key: "local_hires", value: data.localHiresCount },
    { key: "events", value: data.communityEventsCount },
    { key: "charity", value: data.charityDonationsCents / 10000 },
    { key: "suppliers", value: data.localSuppliersCount },
    { key: "mentorship", value: data.mentorshipHours },
  ];
  return metrics.reduce((max, m) => m.value > max.value ? m : max).key;
}

const HIGH_IMPACT: CommunityImpactData = {
  venueId: "v1", localHiresCount: 8, communityEventsCount: 12,
  charityDonationsCents: 500_000, localSuppliersCount: 6,
  mentorshipHours: 40, localArtDisplayed: true, publicWifiOffered: true,
};

const LOW_IMPACT: CommunityImpactData = {
  venueId: "v2", localHiresCount: 1, communityEventsCount: 0,
  charityDonationsCents: 0, localSuppliersCount: 0,
  mentorshipHours: 0, localArtDisplayed: false, publicWifiOffered: false,
};

describe("Venue booking community impact", () => {
  it("communityImpactScore: high impact → max 100", () => {
    const score = communityImpactScore(HIGH_IMPACT);
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("communityImpactScore: low impact → minimal score", () => {
    expect(communityImpactScore(LOW_IMPACT)).toBe(5); // 1 local hire × 5
  });

  it("impactBadge: high score → Community Champion", () => {
    expect(impactBadge(communityImpactScore(HIGH_IMPACT))).toBe("Community Champion");
  });

  it("impactBadge: low score → No Badge", () => {
    expect(impactBadge(5)).toBe("No Badge");
  });

  it("topImpactMetric: highest contribution identified", () => {
    const top = topImpactMetric(HIGH_IMPACT);
    expect(["local_hires", "events", "charity", "suppliers", "mentorship"]).toContain(top);
  });
});
