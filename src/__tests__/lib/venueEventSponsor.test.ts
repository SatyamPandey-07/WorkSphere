/**
 * Tests for venue event sponsorship tier management.
 */

type SponsorTier = "bronze" | "silver" | "gold" | "platinum";

interface SponsorPackage {
  tier: SponsorTier;
  contributionCents: number;
  benefits: string[];
  logoPlacement: "none" | "small" | "medium" | "large";
  speakingSlotMinutes: number;
}

const SPONSOR_TIERS: Record<SponsorTier, SponsorPackage> = {
  bronze:   { tier: "bronze",   contributionCents: 50_000,  benefits: ["logo"],                logoPlacement: "small",  speakingSlotMinutes: 0  },
  silver:   { tier: "silver",   contributionCents: 100_000, benefits: ["logo", "booth"],       logoPlacement: "medium", speakingSlotMinutes: 5  },
  gold:     { tier: "gold",     contributionCents: 250_000, benefits: ["logo", "booth", "talk"],logoPlacement: "large",  speakingSlotMinutes: 15 },
  platinum: { tier: "platinum", contributionCents: 500_000, benefits: ["logo", "booth", "talk", "vip"], logoPlacement: "large", speakingSlotMinutes: 30 },
};

function getSponsorPackage(tier: SponsorTier): SponsorPackage {
  return SPONSOR_TIERS[tier];
}

function hasBenefit(tier: SponsorTier, benefit: string): boolean {
  return SPONSOR_TIERS[tier].benefits.includes(benefit);
}

function totalSponsorRevenue(sponsors: { tier: SponsorTier }[]): number {
  return sponsors.reduce((sum, s) => sum + SPONSOR_TIERS[s.tier].contributionCents, 0);
}

function upgradeTier(currentTier: SponsorTier): SponsorTier {
  const order: SponsorTier[] = ["bronze", "silver", "gold", "platinum"];
  const idx = order.indexOf(currentTier);
  return order[Math.min(idx + 1, order.length - 1)];
}

describe("Venue event sponsorship", () => {
  it("getSponsorPackage: gold has speaking slot 15min", () => {
    expect(getSponsorPackage("gold").speakingSlotMinutes).toBe(15);
  });

  it("hasBenefit: platinum has vip", () => {
    expect(hasBenefit("platinum", "vip")).toBe(true);
  });

  it("hasBenefit: bronze has no booth", () => {
    expect(hasBenefit("bronze", "booth")).toBe(false);
  });

  it("totalSponsorRevenue: bronze + gold = 300000", () => {
    expect(totalSponsorRevenue([{ tier: "bronze" }, { tier: "gold" }])).toBe(300_000);
  });

  it("upgradeTier: bronze → silver", () => {
    expect(upgradeTier("bronze")).toBe("silver");
  });

  it("upgradeTier: platinum stays platinum", () => {
    expect(upgradeTier("platinum")).toBe("platinum");
  });

  it("getSponsorPackage: platinum has large logo", () => {
    expect(getSponsorPackage("platinum").logoPlacement).toBe("large");
  });

  it("getSponsorPackage: bronze has small logo", () => {
    expect(getSponsorPackage("bronze").logoPlacement).toBe("small");
  });
});
