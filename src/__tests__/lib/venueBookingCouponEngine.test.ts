/**
 * Tests for venue booking coupon and promotional code engine.
 */

type CouponType = "percent" | "fixed" | "free_addon" | "buy_x_get_y";
type CouponStatus = "active" | "expired" | "exhausted" | "suspended";

interface Coupon {
  code: string;
  type: CouponType;
  value: number;           // percent off or fixed amount
  minOrderValue: number;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usedCount: number;
  validFrom: number;
  validUntil: number;
  status: CouponStatus;
  applicableVenueIds: string[] | null;  // null = all venues
}

function isCouponValid(coupon: Coupon, nowMs: number): boolean {
  if (coupon.status !== "active") return false;
  if (nowMs < coupon.validFrom || nowMs > coupon.validUntil) return false;
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return false;
  return true;
}

function couponDiscount(coupon: Coupon, orderAmount: number): number {
  if (orderAmount < coupon.minOrderValue) return 0;
  let discount = 0;
  if (coupon.type === "percent") {
    discount = orderAmount * (coupon.value / 100);
  } else if (coupon.type === "fixed") {
    discount = Math.min(coupon.value, orderAmount);
  }
  if (coupon.maxDiscountAmount !== null) {
    discount = Math.min(discount, coupon.maxDiscountAmount);
  }
  return Math.round(discount * 100) / 100;
}

function applyCoupon(orderAmount: number, coupon: Coupon, nowMs: number): number | null {
  if (!isCouponValid(coupon, nowMs)) return null;
  const discount = couponDiscount(coupon, orderAmount);
  return Math.round((orderAmount - discount) * 100) / 100;
}

function usageRemaining(coupon: Coupon): number | null {
  if (coupon.usageLimit === null) return null;
  return Math.max(0, coupon.usageLimit - coupon.usedCount);
}

const NOW = 1_700_000_000_000;
const COUPON: Coupon = {
  code: "SAVE20", type: "percent", value: 20, minOrderValue: 100,
  maxDiscountAmount: 50, usageLimit: 100, usedCount: 30,
  validFrom: NOW - 30 * 86_400_000, validUntil: NOW + 30 * 86_400_000,
  status: "active", applicableVenueIds: null,
};

describe("Coupon engine", () => {
  it("isCouponValid: valid active coupon → true", () => {
    expect(isCouponValid(COUPON, NOW)).toBe(true);
  });

  it("isCouponValid: expired coupon → false", () => {
    expect(isCouponValid({ ...COUPON, validUntil: NOW - 1 }, NOW)).toBe(false);
  });

  it("couponDiscount: 20% of $200 = $40", () => {
    expect(couponDiscount(COUPON, 200)).toBe(40);
  });

  it("couponDiscount: 20% of $400 capped at $50", () => {
    expect(couponDiscount(COUPON, 400)).toBe(50);
  });

  it("couponDiscount: below min order → $0", () => {
    expect(couponDiscount(COUPON, 50)).toBe(0);
  });

  it("applyCoupon: $200 - $40 = $160", () => {
    expect(applyCoupon(200, COUPON, NOW)).toBe(160);
  });

  it("usageRemaining: 100 - 30 = 70", () => {
    expect(usageRemaining(COUPON)).toBe(70);
  });
});
