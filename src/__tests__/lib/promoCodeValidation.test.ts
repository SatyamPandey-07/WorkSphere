/**
 * Tests for promotional code validation and discount application.
 */

interface PromoCode {
  code: string;
  discountPct: number;
  maxUsages: number;
  usedCount: number;
  expiresAt: number;
  minOrderCents: number;
}

function isPromoValid(
  promo: PromoCode,
  orderCents: number,
  nowMs: number
): { valid: boolean; reason?: string } {
  if (nowMs > promo.expiresAt) return { valid: false, reason: "expired" };
  if (promo.usedCount >= promo.maxUsages) return { valid: false, reason: "exhausted" };
  if (orderCents < promo.minOrderCents) return { valid: false, reason: "below_minimum" };
  return { valid: true };
}

function applyPromo(orderCents: number, promo: PromoCode): number {
  const discount = Math.round(orderCents * (promo.discountPct / 100));
  return Math.max(0, orderCents - discount);
}

const NOW = 1_700_000_000_000;
const PROMO: PromoCode = {
  code: "SAVE20", discountPct: 20, maxUsages: 100, usedCount: 50,
  expiresAt: NOW + 3_600_000, minOrderCents: 1000,
};

describe("Promo code validation", () => {
  it("valid promo and order", () => {
    expect(isPromoValid(PROMO, 2000, NOW)).toEqual({ valid: true });
  });

  it("expired promo → invalid", () => {
    expect(isPromoValid(PROMO, 2000, NOW + 4_000_000).valid).toBe(false);
    expect(isPromoValid(PROMO, 2000, NOW + 4_000_000).reason).toBe("expired");
  });

  it("exhausted promo → invalid", () => {
    const exhausted = { ...PROMO, usedCount: 100 };
    expect(isPromoValid(exhausted, 2000, NOW).reason).toBe("exhausted");
  });

  it("order below minimum → invalid", () => {
    expect(isPromoValid(PROMO, 500, NOW).reason).toBe("below_minimum");
  });

  it("order exactly at minimum → valid", () => {
    expect(isPromoValid(PROMO, 1000, NOW).valid).toBe(true);
  });

  it("applyPromo: 20% off 2000 cents → 1600", () => {
    expect(applyPromo(2000, PROMO)).toBe(1600);
  });

  it("applyPromo: 100% off → 0", () => {
    expect(applyPromo(1000, { ...PROMO, discountPct: 100 })).toBe(0);
  });

  it("applyPromo: 0% off → unchanged", () => {
    expect(applyPromo(1000, { ...PROMO, discountPct: 0 })).toBe(1000);
  });
});
