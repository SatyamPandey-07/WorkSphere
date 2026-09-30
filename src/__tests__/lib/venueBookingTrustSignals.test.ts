/**
 * Tests for venue trust signals display logic.
 */

interface TrustSignal {
  type: "verified" | "reviewed" | "insured" | "certified" | "popular" | "new";
  value: string | number | boolean;
  displayPriority: number;  // 1=highest
  badge?: string;
}

interface VenueTrustProfile {
  venueId: string;
  signals: TrustSignal[];
  overallTrustScore: number;  // 0-100
  isVerified: boolean;
}

function activeTrustSignals(profile: VenueTrustProfile): TrustSignal[] {
  return profile.signals
    .filter((s) => s.value !== false && s.value !== 0 && s.value !== "")
    .sort((a, b) => a.displayPriority - b.displayPriority);
}

function topTrustBadges(profile: VenueTrustProfile, limit = 3): string[] {
  return activeTrustSignals(profile)
    .filter((s) => s.badge !== undefined)
    .slice(0, limit)
    .map((s) => s.badge!);
}

function trustScoreLabel(score: number): "unverified" | "trusted" | "highly_trusted" | "elite" {
  if (score >= 90) return "elite";
  if (score >= 75) return "highly_trusted";
  if (score >= 50) return "trusted";
  return "unverified";
}

function hasCriticalTrustSignal(profile: VenueTrustProfile, signalType: string): boolean {
  return profile.signals.some((s) => s.type === signalType && s.value !== false);
}

const PROFILE: VenueTrustProfile = {
  venueId: "v1",
  overallTrustScore: 85,
  isVerified: true,
  signals: [
    { type: "verified",   value: true,   displayPriority: 1, badge: "✓ Verified"   },
    { type: "reviewed",   value: 127,    displayPriority: 2, badge: "127 Reviews"  },
    { type: "insured",    value: true,   displayPriority: 3, badge: "Insured"      },
    { type: "certified",  value: "LEED", displayPriority: 4, badge: "LEED Cert."  },
    { type: "popular",    value: false,  displayPriority: 5                         }, // inactive
  ],
};

describe("Venue trust signals", () => {
  it("activeTrustSignals: excludes false/zero/empty", () => {
    const active = activeTrustSignals(PROFILE);
    expect(active.every((s) => s.value !== false)).toBe(true);
  });

  it("activeTrustSignals: sorted by displayPriority", () => {
    const active = activeTrustSignals(PROFILE);
    for (let i = 0; i < active.length - 1; i++) {
      expect(active[i].displayPriority).toBeLessThanOrEqual(active[i + 1].displayPriority);
    }
  });

  it("topTrustBadges: top 3 badges", () => {
    const badges = topTrustBadges(PROFILE, 3);
    expect(badges).toHaveLength(3);
    expect(badges[0]).toBe("✓ Verified");
  });

  it("trustScoreLabel: 85 → highly_trusted", () => {
    expect(trustScoreLabel(85)).toBe("highly_trusted");
  });

  it("trustScoreLabel: 95 → elite", () => {
    expect(trustScoreLabel(95)).toBe("elite");
  });

  it("hasCriticalTrustSignal: verified signal present", () => {
    expect(hasCriticalTrustSignal(PROFILE, "verified")).toBe(true);
  });

  it("hasCriticalTrustSignal: popular = false → false", () => {
    expect(hasCriticalTrustSignal(PROFILE, "popular")).toBe(false);
  });
});
