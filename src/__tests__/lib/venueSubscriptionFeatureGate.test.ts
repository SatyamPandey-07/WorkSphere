/**
 * Tests for venue subscription plan feature gating.
 */

type VenuePlan = "free" | "starter" | "growth" | "enterprise";

interface FeatureGate {
  featureKey: string;
  name: string;
  minPlan: VenuePlan;
  softLimit?: number;  // max for non-enterprise, null = unlimited
  hardGate: boolean;   // if true, blocked entirely below minPlan
}

const PLAN_ORDER: VenuePlan[] = ["free", "starter", "growth", "enterprise"];

const FEATURE_GATES: FeatureGate[] = [
  { featureKey: "basic_listing",   name: "Basic Listing",       minPlan: "free",       softLimit: undefined, hardGate: false },
  { featureKey: "analytics",       name: "Analytics Dashboard", minPlan: "starter",    softLimit: 30,        hardGate: false },
  { featureKey: "multi_location",  name: "Multi-Location",      minPlan: "growth",     softLimit: 5,         hardGate: false },
  { featureKey: "white_label",     name: "White Label",         minPlan: "enterprise", softLimit: undefined, hardGate: true  },
  { featureKey: "api_access",      name: "API Access",          minPlan: "growth",     softLimit: 1000,      hardGate: false },
];

function hasFeatureAccess(plan: VenuePlan, featureKey: string): boolean {
  const gate = FEATURE_GATES.find((f) => f.featureKey === featureKey);
  if (!gate) return false;
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(gate.minPlan);
}

function getFeatureLimit(plan: VenuePlan, featureKey: string): number | null {
  const gate = FEATURE_GATES.find((f) => f.featureKey === featureKey);
  if (!gate || !hasFeatureAccess(plan, featureKey)) return 0;
  if (plan === "enterprise" || gate.softLimit === undefined) return null; // unlimited
  return gate.softLimit;
}

function isFeatureBlocked(plan: VenuePlan, featureKey: string): boolean {
  const gate = FEATURE_GATES.find((f) => f.featureKey === featureKey);
  if (!gate) return true;
  return gate.hardGate && !hasFeatureAccess(plan, featureKey);
}

function availableFeatures(plan: VenuePlan): string[] {
  return FEATURE_GATES
    .filter((f) => hasFeatureAccess(plan, f.featureKey))
    .map((f) => f.featureKey);
}

describe("Venue subscription feature gate", () => {
  it("hasFeatureAccess: free plan has basic_listing", () => {
    expect(hasFeatureAccess("free", "basic_listing")).toBe(true);
  });

  it("hasFeatureAccess: free plan no analytics", () => {
    expect(hasFeatureAccess("free", "analytics")).toBe(false);
  });

  it("hasFeatureAccess: enterprise has all features", () => {
    expect(FEATURE_GATES.every((f) => hasFeatureAccess("enterprise", f.featureKey))).toBe(true);
  });

  it("getFeatureLimit: starter analytics = 30 (soft limit)", () => {
    expect(getFeatureLimit("starter", "analytics")).toBe(30);
  });

  it("getFeatureLimit: enterprise analytics = null (unlimited)", () => {
    expect(getFeatureLimit("enterprise", "analytics")).toBeNull();
  });

  it("getFeatureLimit: no access → 0", () => {
    expect(getFeatureLimit("free", "analytics")).toBe(0);
  });

  it("isFeatureBlocked: white_label for free → true (hard gate)", () => {
    expect(isFeatureBlocked("free", "white_label")).toBe(true);
  });

  it("isFeatureBlocked: white_label for enterprise → false", () => {
    expect(isFeatureBlocked("enterprise", "white_label")).toBe(false);
  });

  it("availableFeatures: starter has more than free", () => {
    const free = availableFeatures("free");
    const starter = availableFeatures("starter");
    expect(starter.length).toBeGreaterThan(free.length);
  });
});
