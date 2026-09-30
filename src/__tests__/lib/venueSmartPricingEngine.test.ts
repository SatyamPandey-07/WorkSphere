/**
 * Tests for venue smart pricing engine combining multiple factors.
 */

interface PricingContext {
  baseRateCents: number;
  occupancyRatio: number;       // 0-1
  daysBeforeBooking: number;
  isWeekend: boolean;
  memberDiscountPct: number;    // 0 for non-members
  promoDiscountPct: number;     // 0 if no promo
  maxMultiplier: number;
}

function demandMultiplier(ctx: PricingContext): number {
  let mult = 1.0;
  if (ctx.occupancyRatio > 0.8) mult += 0.3;
  else if (ctx.occupancyRatio > 0.6) mult += 0.1;
  if (ctx.daysBeforeBooking <= 1) mult += 0.2;
  if (ctx.isWeekend) mult += 0.1;
  return Math.min(mult, ctx.maxMultiplier);
}

function applyDiscounts(priceCents: number, ctx: PricingContext): number {
  const memberSavings = Math.round(priceCents * (ctx.memberDiscountPct / 100));
  const afterMember = priceCents - memberSavings;
  const promoSavings = Math.round(afterMember * (ctx.promoDiscountPct / 100));
  return Math.max(0, afterMember - promoSavings);
}

function finalPrice(ctx: PricingContext): number {
  const boosted = Math.round(ctx.baseRateCents * demandMultiplier(ctx));
  return applyDiscounts(boosted, ctx);
}

function pricingBreakdown(ctx: PricingContext): {
  base: number;
  afterDemand: number;
  afterDiscounts: number;
  savings: number;
} {
  const afterDemand = Math.round(ctx.baseRateCents * demandMultiplier(ctx));
  const afterDiscounts = applyDiscounts(afterDemand, ctx);
  return {
    base: ctx.baseRateCents,
    afterDemand,
    afterDiscounts,
    savings: afterDemand - afterDiscounts,
  };
}

const BASE_CTX: PricingContext = {
  baseRateCents: 1000, occupancyRatio: 0.5, daysBeforeBooking: 7,
  isWeekend: false, memberDiscountPct: 0, promoDiscountPct: 0, maxMultiplier: 2.0,
};

describe("Venue smart pricing engine", () => {
  it("demandMultiplier: no special factors = 1.0", () => {
    expect(demandMultiplier(BASE_CTX)).toBe(1.0);
  });

  it("demandMultiplier: high occupancy + last minute + weekend", () => {
    const ctx = { ...BASE_CTX, occupancyRatio: 0.9, daysBeforeBooking: 0, isWeekend: true };
    expect(demandMultiplier(ctx)).toBeGreaterThan(1.5);
  });

  it("demandMultiplier: capped at maxMultiplier", () => {
    const ctx = { ...BASE_CTX, occupancyRatio: 0.95, daysBeforeBooking: 0, isWeekend: true, maxMultiplier: 1.5 };
    expect(demandMultiplier(ctx)).toBe(1.5);
  });

  it("applyDiscounts: member 10% + promo 5% stacks", () => {
    const ctx = { ...BASE_CTX, memberDiscountPct: 10, promoDiscountPct: 5 };
    const after10Pct = 1000 - 100;
    const after5Pct = after10Pct - Math.round(after10Pct * 0.05);
    expect(applyDiscounts(1000, ctx)).toBe(after5Pct);
  });

  it("finalPrice: base with no modifiers = base", () => {
    expect(finalPrice(BASE_CTX)).toBe(1000);
  });

  it("finalPrice: member discount reduces final price", () => {
    const withDiscount = { ...BASE_CTX, memberDiscountPct: 20 };
    expect(finalPrice(withDiscount)).toBe(800);
  });

  it("pricingBreakdown: savings = afterDemand - afterDiscounts", () => {
    const ctx = { ...BASE_CTX, memberDiscountPct: 10 };
    const bd = pricingBreakdown(ctx);
    expect(bd.savings).toBe(bd.afterDemand - bd.afterDiscounts);
  });
});
