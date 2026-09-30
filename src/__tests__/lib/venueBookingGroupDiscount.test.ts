/**
 * Tests for group booking discount tiers.
 */

interface GroupDiscountTier {
  minGroupSize: number;
  maxGroupSize: number;
  discountPct: number;
  label: string;
}

const GROUP_DISCOUNT_TIERS: GroupDiscountTier[] = [
  { minGroupSize: 2,  maxGroupSize: 4,  discountPct: 5,  label: "Small Group" },
  { minGroupSize: 5,  maxGroupSize: 9,  discountPct: 10, label: "Medium Group" },
  { minGroupSize: 10, maxGroupSize: 19, discountPct: 15, label: "Large Group"  },
  { minGroupSize: 20, maxGroupSize: 999,discountPct: 20, label: "Enterprise"   },
];

function getGroupDiscountTier(groupSize: number): GroupDiscountTier | null {
  return GROUP_DISCOUNT_TIERS.find(
    (t) => groupSize >= t.minGroupSize && groupSize <= t.maxGroupSize
  ) ?? null;
}

function applyGroupDiscount(basePriceCents: number, groupSize: number): number {
  const tier = getGroupDiscountTier(groupSize);
  if (!tier) return basePriceCents;
  return Math.round(basePriceCents * (1 - tier.discountPct / 100));
}

function groupDiscountAmount(basePriceCents: number, groupSize: number): number {
  return basePriceCents - applyGroupDiscount(basePriceCents, groupSize);
}

function nextTierAt(groupSize: number): number | null {
  const currentTierIdx = GROUP_DISCOUNT_TIERS.findIndex(
    (t) => groupSize >= t.minGroupSize && groupSize <= t.maxGroupSize
  );
  if (currentTierIdx === -1) {
    // Below first tier: return first tier min size
    return GROUP_DISCOUNT_TIERS[0].minGroupSize;
  }
  const nextTier = GROUP_DISCOUNT_TIERS[currentTierIdx + 1];
  return nextTier ? nextTier.minGroupSize : null; // null if already at max tier
}

describe("Venue booking group discounts", () => {
  it("getGroupDiscountTier: 3 people → small group tier", () => {
    expect(getGroupDiscountTier(3)?.label).toBe("Small Group");
  });

  it("getGroupDiscountTier: 1 person → null (no discount)", () => {
    expect(getGroupDiscountTier(1)).toBeNull();
  });

  it("getGroupDiscountTier: 25 people → enterprise", () => {
    expect(getGroupDiscountTier(25)?.label).toBe("Enterprise");
  });

  it("applyGroupDiscount: 5% off for 3 people", () => {
    expect(applyGroupDiscount(10000, 3)).toBe(9500);
  });

  it("applyGroupDiscount: 20% off for 20 people", () => {
    expect(applyGroupDiscount(10000, 20)).toBe(8000);
  });

  it("applyGroupDiscount: no discount for solo", () => {
    expect(applyGroupDiscount(10000, 1)).toBe(10000);
  });

  it("groupDiscountAmount: savings for 10 people = 15%", () => {
    expect(groupDiscountAmount(10000, 10)).toBe(1500);
  });

  it("nextTierAt: 7 people (medium) → next tier at 10", () => {
    expect(nextTierAt(7)).toBe(10);
  });

  it("nextTierAt: 1 person → enter small group at 2", () => {
    expect(nextTierAt(1)).toBe(2);
  });

  it("nextTierAt: enterprise → null (max tier)", () => {
    expect(nextTierAt(25)).toBeNull();
  });
});
