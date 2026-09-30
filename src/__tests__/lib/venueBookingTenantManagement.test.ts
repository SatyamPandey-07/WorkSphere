/**
 * Tests for multi-tenant venue management.
 */

interface Tenant {
  tenantId: string;
  organizationName: string;
  billingEmail: string;
  plan: "starter" | "business" | "enterprise";
  venueIds: string[];
  usersCount: number;
  monthlyBookings: number;
  billingCycle: "monthly" | "annual";
}

function tenantMonthlySpendCents(tenant: Tenant, bookingAvgCents: number): number {
  return tenant.monthlyBookings * bookingAvgCents;
}

function tenantPlanUpgradeEligible(tenant: Tenant): boolean {
  const thresholds: Record<string, { bookings: number; venues: number }> = {
    starter:  { bookings: 50,  venues: 3  },
    business: { bookings: 200, venues: 10 },
  };
  const current = thresholds[tenant.plan];
  if (!current) return false; // enterprise can't upgrade
  return tenant.monthlyBookings >= current.bookings || tenant.venueIds.length >= current.venues;
}

function suggestedPlan(tenant: Tenant): string {
  if (tenant.monthlyBookings >= 200 || tenant.venueIds.length >= 10) return "enterprise";
  if (tenant.monthlyBookings >= 50 || tenant.venueIds.length >= 3) return "business";
  return "starter";
}

function tenantHealthScore(tenant: Tenant): number {
  const bookingsPerVenue = tenant.monthlyBookings / Math.max(1, tenant.venueIds.length);
  const userEngagement = Math.min(tenant.usersCount / tenant.venueIds.length, 10);
  return Math.round((bookingsPerVenue / 20 + userEngagement / 10) * 50);
}

const TENANTS: Tenant[] = [
  { tenantId: "t1", organizationName: "TechCo",   billingEmail: "b@techco.com", plan: "starter",  venueIds: ["v1", "v2"], usersCount: 15, monthlyBookings: 60,  billingCycle: "monthly" },
  { tenantId: "t2", organizationName: "MegaCorp",  billingEmail: "b@mega.com",   plan: "business", venueIds: ["v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"], usersCount: 200, monthlyBookings: 300, billingCycle: "annual" },
  { tenantId: "t3", organizationName: "SmallBiz",  billingEmail: "b@small.com",  plan: "starter",  venueIds: ["v12"], usersCount: 5, monthlyBookings: 10, billingCycle: "monthly" },
];

describe("Multi-tenant venue management", () => {
  it("tenantMonthlySpendCents: TechCo 60 bookings × 5000 = 300000", () => {
    expect(tenantMonthlySpendCents(TENANTS[0], 5000)).toBe(300000);
  });

  it("tenantPlanUpgradeEligible: TechCo (60 bookings > 50 threshold) → eligible for upgrade", () => {
    expect(tenantPlanUpgradeEligible(TENANTS[0])).toBe(true);
  });

  it("tenantPlanUpgradeEligible: SmallBiz (10 bookings < 50 threshold) → not eligible", () => {
    expect(tenantPlanUpgradeEligible(TENANTS[2])).toBe(false);
  });

  it("tenantPlanUpgradeEligible: enterprise → false (max tier)", () => {
    const enterprise = { ...TENANTS[1], plan: "enterprise" as const };
    expect(tenantPlanUpgradeEligible(enterprise)).toBe(false);
  });

  it("suggestedPlan: MegaCorp (300 bookings) → enterprise", () => {
    expect(suggestedPlan(TENANTS[1])).toBe("enterprise");
  });

  it("suggestedPlan: TechCo (60 bookings, 2 venues) → business", () => {
    expect(suggestedPlan(TENANTS[0])).toBe("business");
  });

  it("tenantHealthScore: higher for active tenants", () => {
    const megaScore = tenantHealthScore(TENANTS[1]);
    const smallScore = tenantHealthScore(TENANTS[2]);
    expect(megaScore).toBeGreaterThan(smallScore);
  });
});
