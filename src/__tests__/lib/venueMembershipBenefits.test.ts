/**
 * Tests for venue-specific membership benefits calculation.
 */

interface VenueMembership {
  userId: string;
  venueId: string;
  tier: "basic" | "regular" | "vip";
  monthlyFeesCents: number;
  joinedAt: number;
  expiresAt: number;
}

const MEMBERSHIP_PERKS: Record<string, { discountPct: number; priorityBooking: boolean; guestPasses: number }> = {
  basic:   { discountPct: 0,  priorityBooking: false, guestPasses: 0 },
  regular: { discountPct: 10, priorityBooking: false, guestPasses: 2 },
  vip:     { discountPct: 20, priorityBooking: true,  guestPasses: 5 },
};

function getMembershipPerks(membership: VenueMembership) {
  return MEMBERSHIP_PERKS[membership.tier];
}

function applyMembershipDiscount(baseCents: number, membership: VenueMembership): number {
  const { discountPct } = getMembershipPerks(membership);
  return Math.round(baseCents * (1 - discountPct / 100));
}

function isMembershipActive(membership: VenueMembership, nowMs: number): boolean {
  return nowMs < membership.expiresAt;
}

function monthsAsMember(membership: VenueMembership, nowMs: number): number {
  return Math.floor((nowMs - membership.joinedAt) / (30 * 86_400_000));
}

function loyaltyBonus(membership: VenueMembership, nowMs: number): number {
  const months = monthsAsMember(membership, nowMs);
  return Math.min(months * 50, 500); // 50 pts/month, max 500
}

const NOW = 1_700_000_000_000;
const VIP: VenueMembership = {
  userId: "u1", venueId: "v1", tier: "vip",
  monthlyFeesCents: 5000, joinedAt: NOW - 6 * 30 * 86_400_000, // 6 months ago
  expiresAt: NOW + 30 * 86_400_000,
};

describe("Venue membership benefits", () => {
  it("getMembershipPerks: VIP has 20% discount", () => {
    expect(getMembershipPerks(VIP).discountPct).toBe(20);
  });

  it("getMembershipPerks: VIP has priority booking", () => {
    expect(getMembershipPerks(VIP).priorityBooking).toBe(true);
  });

  it("applyMembershipDiscount: VIP 20% off 10000 = 8000", () => {
    expect(applyMembershipDiscount(10000, VIP)).toBe(8000);
  });

  it("isMembershipActive: not expired → true", () => {
    expect(isMembershipActive(VIP, NOW)).toBe(true);
  });

  it("isMembershipActive: expired → false", () => {
    expect(isMembershipActive(VIP, NOW + 40 * 86_400_000)).toBe(false);
  });

  it("monthsAsMember: 6 months", () => {
    expect(monthsAsMember(VIP, NOW)).toBe(6);
  });

  it("loyaltyBonus: 6 months × 50 = 300", () => {
    expect(loyaltyBonus(VIP, NOW)).toBe(300);
  });

  it("loyaltyBonus: capped at 500", () => {
    const longMember = { ...VIP, joinedAt: NOW - 15 * 30 * 86_400_000 };
    expect(loyaltyBonus(longMember, NOW)).toBe(500);
  });
});
