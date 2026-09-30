/**
 * Tests for venue trust/credibility score based on verification signals.
 */

interface VenueVerification {
  addressVerified: boolean;
  ownerIdentityVerified: boolean;
  hasPhotos: boolean;
  photosVerified: boolean;
  recentActivity: boolean; // updated in last 30 days
  minimumReviews: boolean; // ≥ 5 reviews
}

const TRUST_WEIGHTS = {
  addressVerified:       25,
  ownerIdentityVerified: 25,
  hasPhotos:             10,
  photosVerified:        15,
  recentActivity:        10,
  minimumReviews:        15,
};

function trustScore(v: VenueVerification): number {
  return (Object.keys(TRUST_WEIGHTS) as (keyof VenueVerification)[])
    .filter((k) => v[k])
    .reduce((sum, k) => sum + TRUST_WEIGHTS[k], 0);
}

function trustBadge(score: number): "unverified" | "basic" | "trusted" | "certified" {
  if (score < 25)  return "unverified";
  if (score < 50)  return "basic";
  if (score < 85)  return "trusted";
  return "certified";
}

const NONE: VenueVerification = {
  addressVerified: false, ownerIdentityVerified: false, hasPhotos: false,
  photosVerified: false, recentActivity: false, minimumReviews: false,
};
const ALL: VenueVerification = {
  addressVerified: true, ownerIdentityVerified: true, hasPhotos: true,
  photosVerified: true, recentActivity: true, minimumReviews: true,
};

describe("Venue trust score", () => {
  it("no verification → 0", () => {
    expect(trustScore(NONE)).toBe(0);
  });

  it("all verified → 100", () => {
    expect(trustScore(ALL)).toBe(100);
  });

  it("address only → 25", () => {
    expect(trustScore({ ...NONE, addressVerified: true })).toBe(25);
  });

  it("address + owner → 50", () => {
    expect(trustScore({ ...NONE, addressVerified: true, ownerIdentityVerified: true })).toBe(50);
  });

  it("badge unverified for score < 25", () => {
    expect(trustBadge(10)).toBe("unverified");
  });

  it("badge basic for 25–49", () => {
    expect(trustBadge(40)).toBe("basic");
  });

  it("badge trusted for 50–84", () => {
    expect(trustBadge(70)).toBe("trusted");
  });

  it("badge certified for ≥ 85", () => {
    expect(trustBadge(100)).toBe("certified");
  });

  it("full score earns certified badge", () => {
    expect(trustBadge(trustScore(ALL))).toBe("certified");
  });
});
