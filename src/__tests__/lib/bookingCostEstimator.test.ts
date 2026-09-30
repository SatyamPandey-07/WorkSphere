/**
 * Tests for booking cost estimator with all fee components.
 */

interface BookingCostBreakdown {
  baseCents: number;
  taxCents: number;
  serviceFee: number;
  discountCents: number;
  totalCents: number;
}

function estimateBookingCost(
  hourlyRateCents: number,
  hours: number,
  taxRatePct: number,
  serviceFeePct: number,
  discountPct = 0
): BookingCostBreakdown {
  const baseCents = hourlyRateCents * hours;
  const discountCents = Math.round(baseCents * (discountPct / 100));
  const afterDiscount = baseCents - discountCents;
  const taxCents = Math.round(afterDiscount * (taxRatePct / 100));
  const serviceFee = Math.round(afterDiscount * (serviceFeePct / 100));
  const totalCents = afterDiscount + taxCents + serviceFee;
  return { baseCents, taxCents, serviceFee, discountCents, totalCents };
}

function formatBreakdown(breakdown: BookingCostBreakdown): Record<string, string> {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  return {
    base:     fmt(breakdown.baseCents),
    discount: `-${fmt(breakdown.discountCents)}`,
    tax:      fmt(breakdown.taxCents),
    fee:      fmt(breakdown.serviceFee),
    total:    fmt(breakdown.totalCents),
  };
}

describe("Booking cost estimator", () => {
  it("base cost = hourlyRate × hours", () => {
    const { baseCents } = estimateBookingCost(1000, 3, 10, 5);
    expect(baseCents).toBe(3000);
  });

  it("tax calculated on discounted base", () => {
    // 3000 base, 10% discount → 2700, 10% tax on 2700 = 270
    const { taxCents } = estimateBookingCost(1000, 3, 10, 5, 10);
    expect(taxCents).toBe(270);
  });

  it("service fee calculated on discounted base", () => {
    // 2700 after discount, 5% service = 135
    const { serviceFee } = estimateBookingCost(1000, 3, 10, 5, 10);
    expect(serviceFee).toBe(135);
  });

  it("total = afterDiscount + tax + fee", () => {
    const b = estimateBookingCost(1000, 3, 10, 5, 10);
    expect(b.totalCents).toBe(2700 + 270 + 135);
  });

  it("no discount → discount 0", () => {
    const { discountCents } = estimateBookingCost(1000, 2, 10, 5);
    expect(discountCents).toBe(0);
  });

  it("100% discount → total is only tax+fee on 0 base", () => {
    const b = estimateBookingCost(1000, 2, 10, 5, 100);
    expect(b.discountCents).toBe(2000);
    expect(b.totalCents).toBe(0);
  });

  it("formatBreakdown: total has dollar sign", () => {
    const b = estimateBookingCost(1000, 2, 10, 5);
    const formatted = formatBreakdown(b);
    expect(formatted.total).toMatch(/^\$/);
  });

  it("formatBreakdown: discount shows negative", () => {
    const b = estimateBookingCost(1000, 2, 10, 5, 10);
    expect(formatBreakdown(b).discount.startsWith("-")).toBe(true);
  });
});
