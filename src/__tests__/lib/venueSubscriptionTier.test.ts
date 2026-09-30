/**
 * Tests for venue owner subscription tier feature gating.
 */

type SubscriptionTier = "free" | "starter" | "pro" | "enterprise";

interface TierFeatures {
  maxListings: number;
  analyticsEnabled: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
  apiAccess: boolean;
}

const TIER_FEATURES: Record<SubscriptionTier, TierFeatures> = {
  free:       { maxListings: 1,   analyticsEnabled: false, customBranding: false, prioritySupport: false, apiAccess: false },
  starter:    { maxListings: 5,   analyticsEnabled: true,  customBranding: false, prioritySupport: false, apiAccess: false },
  pro:        { maxListings: 20,  analyticsEnabled: true,  customBranding: true,  prioritySupport: false, apiAccess: false },
  enterprise: { maxListings: 999, analyticsEnabled: true,  customBranding: true,  prioritySupport: true,  apiAccess: true  },
};

function canAddListing(tier: SubscriptionTier, currentListings: number): boolean {
  return currentListings < TIER_FEATURES[tier].maxListings;
}

function hasFeature(tier: SubscriptionTier, feature: keyof TierFeatures): boolean {
  const val = TIER_FEATURES[tier][feature];
  if (typeof val === "boolean") return val;
  return val > 0;
}

describe("Venue subscription tier feature gating", () => {
  it("free tier: can add first listing", () => {
    expect(canAddListing("free", 0)).toBe(true);
  });

  it("free tier: cannot add second listing", () => {
    expect(canAddListing("free", 1)).toBe(false);
  });

  it("starter tier allows up to 5 listings", () => {
    expect(canAddListing("starter", 4)).toBe(true);
    expect(canAddListing("starter", 5)).toBe(false);
  });

  it("enterprise has effectively unlimited listings", () => {
    expect(canAddListing("enterprise", 998)).toBe(true);
  });

  it("free tier: no analytics", () => {
    expect(hasFeature("free", "analyticsEnabled")).toBe(false);
  });

  it("starter tier: has analytics", () => {
    expect(hasFeature("starter", "analyticsEnabled")).toBe(true);
  });

  it("pro tier: has customBranding", () => {
    expect(hasFeature("pro", "customBranding")).toBe(true);
  });

  it("free tier: no apiAccess", () => {
    expect(hasFeature("free", "apiAccess")).toBe(false);
  });

  it("enterprise: all features enabled", () => {
    const features: (keyof TierFeatures)[] = ["analyticsEnabled", "customBranding", "prioritySupport", "apiAccess"];
    expect(features.every((f) => hasFeature("enterprise", f))).toBe(true);
  });
});
