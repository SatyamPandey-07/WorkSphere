/**
 * Tests for workspace membership tier benefits and eligibility.
 */

type MembershipTier = "basic" | "silver" | "gold" | "platinum";

interface MembershipBenefits {
  guestPasses: number;     // per month
  bookingDiscountPct: number;
  prioritySupport: boolean;
  unlimitedMeetingRooms: boolean;
  freeParking: boolean;
}

const TIER_BENEFITS: Record<MembershipTier, MembershipBenefits> = {
  basic:    { guestPasses: 0, bookingDiscountPct:  0, prioritySupport: false, unlimitedMeetingRooms: false, freeParking: false },
  silver:   { guestPasses: 2, bookingDiscountPct:  5, prioritySupport: false, unlimitedMeetingRooms: false, freeParking: false },
  gold:     { guestPasses: 5, bookingDiscountPct: 10, prioritySupport: true,  unlimitedMeetingRooms: false, freeParking: true  },
  platinum: { guestPasses: 10,bookingDiscountPct: 20, prioritySupport: true,  unlimitedMeetingRooms: true,  freeParking: true  },
};

function getBenefits(tier: MembershipTier): MembershipBenefits {
  return TIER_BENEFITS[tier];
}

function applyMemberDiscount(priceCents: number, tier: MembershipTier): number {
  const { bookingDiscountPct } = getBenefits(tier);
  return Math.round(priceCents * (1 - bookingDiscountPct / 100));
}

function isUpgrade(from: MembershipTier, to: MembershipTier): boolean {
  const order: MembershipTier[] = ["basic", "silver", "gold", "platinum"];
  return order.indexOf(to) > order.indexOf(from);
}

function tierFromPoints(points: number): MembershipTier {
  if (points >= 10000) return "platinum";
  if (points >= 5000)  return "gold";
  if (points >= 1000)  return "silver";
  return "basic";
}

describe("Workspace membership tier", () => {
  it("basic tier: no discount", () => {
    expect(applyMemberDiscount(10000, "basic")).toBe(10000);
  });

  it("gold tier: 10% discount", () => {
    expect(applyMemberDiscount(10000, "gold")).toBe(9000);
  });

  it("platinum tier: 20% discount", () => {
    expect(applyMemberDiscount(10000, "platinum")).toBe(8000);
  });

  it("getBenefits: gold has free parking", () => {
    expect(getBenefits("gold").freeParking).toBe(true);
  });

  it("getBenefits: platinum has unlimited meeting rooms", () => {
    expect(getBenefits("platinum").unlimitedMeetingRooms).toBe(true);
  });

  it("isUpgrade: basic → gold = true", () => {
    expect(isUpgrade("basic", "gold")).toBe(true);
  });

  it("isUpgrade: gold → silver = false (downgrade)", () => {
    expect(isUpgrade("gold", "silver")).toBe(false);
  });

  it("isUpgrade: same tier = false", () => {
    expect(isUpgrade("silver", "silver")).toBe(false);
  });

  it("tierFromPoints: 7500 → gold", () => {
    expect(tierFromPoints(7500)).toBe("gold");
  });

  it("tierFromPoints: 500 → basic", () => {
    expect(tierFromPoints(500)).toBe("basic");
  });

  it("tierFromPoints: 12000 → platinum", () => {
    expect(tierFromPoints(12000)).toBe("platinum");
  });
});
