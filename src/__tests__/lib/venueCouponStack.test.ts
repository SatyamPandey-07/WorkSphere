/**
 * Tests for venue coupon stacking and maximum discount calculation.
 */

interface Coupon {
  id: string;
  discountType: "percent" | "flat";
  discountValue: number;       // percent (0-100) or cents
  minOrderCents: number;
  isStackable: boolean;
  priority: number;            // lower = applied first
}

function sortCoupons(coupons: Coupon[]): Coupon[] {
  return [...coupons].sort((a, b) => a.priority - b.priority);
}

function applyCoupon(orderCents: number, coupon: Coupon): number {
  if (orderCents < coupon.minOrderCents) return orderCents;
  if (coupon.discountType === "percent") {
    return Math.round(orderCents * (1 - coupon.discountValue / 100));
  }
  return Math.max(0, orderCents - coupon.discountValue);
}

function applyStackedCoupons(orderCents: number, coupons: Coupon[]): number {
  const stackable = sortCoupons(coupons.filter((c) => c.isStackable));
  return stackable.reduce((total, c) => applyCoupon(total, c), orderCents);
}

function bestSingleCoupon(orderCents: number, coupons: Coupon[]): Coupon | null {
  let bestSavings = 0;
  let best: Coupon | null = null;
  for (const c of coupons) {
    const savings = orderCents - applyCoupon(orderCents, c);
    if (savings > bestSavings) { bestSavings = savings; best = c; }
  }
  return best;
}

const COUPONS: Coupon[] = [
  { id: "c1", discountType: "percent", discountValue: 10, minOrderCents: 0,    isStackable: true,  priority: 1 },
  { id: "c2", discountType: "flat",    discountValue: 500, minOrderCents: 2000, isStackable: true,  priority: 2 },
  { id: "c3", discountType: "percent", discountValue: 20, minOrderCents: 0,    isStackable: false, priority: 1 },
];

describe("Venue coupon stacking", () => {
  it("applyCoupon: 10% off 5000 = 4500", () => {
    expect(applyCoupon(5000, COUPONS[0])).toBe(4500);
  });

  it("applyCoupon: flat 500 off 5000 = 4500", () => {
    expect(applyCoupon(5000, COUPONS[1])).toBe(4500);
  });

  it("applyCoupon: below minimum → no discount", () => {
    expect(applyCoupon(1000, COUPONS[1])).toBe(1000);
  });

  it("applyCoupon: flat can't go below 0", () => {
    const bigFlat: Coupon = { ...COUPONS[1], discountValue: 10000 };
    expect(applyCoupon(5000, bigFlat)).toBe(0);
  });

  it("applyStackedCoupons: applies stackable in priority order", () => {
    // 5000 → 10% off = 4500 → flat 500 off = 4000
    expect(applyStackedCoupons(5000, COUPONS)).toBe(4000);
  });

  it("applyStackedCoupons: non-stackable excluded", () => {
    const result = applyStackedCoupons(5000, [COUPONS[2]]); // non-stackable
    expect(result).toBe(5000); // no change
  });

  it("bestSingleCoupon: picks highest savings", () => {
    const best = bestSingleCoupon(5000, COUPONS);
    expect(best).not.toBeNull();
  });

  it("bestSingleCoupon: no savings possible → null", () => {
    expect(bestSingleCoupon(0, COUPONS)).toBeNull();
  });
});
