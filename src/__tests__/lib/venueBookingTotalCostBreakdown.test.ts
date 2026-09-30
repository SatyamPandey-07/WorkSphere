/**
 * Tests for comprehensive booking total cost breakdown.
 */

interface CostBreakdown {
  baseRateCents: number;
  hours: number;
  seats: number;
  taxes: { name: string; ratePct: number; amountCents: number }[];
  fees: { name: string; amountCents: number }[];
  discounts: { name: string; amountCents: number }[];
  addOns: { name: string; amountCents: number }[];
}

function baseSubtotal(breakdown: CostBreakdown): number {
  return breakdown.baseRateCents * breakdown.hours * breakdown.seats;
}

function totalTaxes(breakdown: CostBreakdown): number {
  return breakdown.taxes.reduce((s, t) => s + t.amountCents, 0);
}

function totalFees(breakdown: CostBreakdown): number {
  return breakdown.fees.reduce((s, f) => s + f.amountCents, 0);
}

function totalDiscounts(breakdown: CostBreakdown): number {
  return breakdown.discounts.reduce((s, d) => s + d.amountCents, 0);
}

function totalAddOns(breakdown: CostBreakdown): number {
  return breakdown.addOns.reduce((s, a) => s + a.amountCents, 0);
}

function grandTotal(breakdown: CostBreakdown): number {
  return Math.max(0,
    baseSubtotal(breakdown) +
    totalTaxes(breakdown) +
    totalFees(breakdown) +
    totalAddOns(breakdown) -
    totalDiscounts(breakdown)
  );
}

function costBreakdownSummary(breakdown: CostBreakdown): Record<string, number> {
  return {
    base: baseSubtotal(breakdown),
    taxes: totalTaxes(breakdown),
    fees: totalFees(breakdown),
    addOns: totalAddOns(breakdown),
    discounts: -totalDiscounts(breakdown),
    total: grandTotal(breakdown),
  };
}

const BREAKDOWN: CostBreakdown = {
  baseRateCents: 500, hours: 4, seats: 2,
  taxes: [{ name: "VAT", ratePct: 20, amountCents: 800 }],
  fees: [{ name: "Service fee", amountCents: 200 }],
  discounts: [{ name: "Member 10%", amountCents: 400 }],
  addOns: [{ name: "Coffee", amountCents: 300 }],
};

describe("Booking total cost breakdown", () => {
  it("baseSubtotal: 500 × 4 × 2 = 4000", () => {
    expect(baseSubtotal(BREAKDOWN)).toBe(4000);
  });

  it("totalTaxes: VAT = 800", () => {
    expect(totalTaxes(BREAKDOWN)).toBe(800);
  });

  it("totalFees: 200", () => {
    expect(totalFees(BREAKDOWN)).toBe(200);
  });

  it("totalDiscounts: 400", () => {
    expect(totalDiscounts(BREAKDOWN)).toBe(400);
  });

  it("totalAddOns: 300", () => {
    expect(totalAddOns(BREAKDOWN)).toBe(300);
  });

  it("grandTotal: 4000+800+200+300-400 = 4900", () => {
    expect(grandTotal(BREAKDOWN)).toBe(4900);
  });

  it("costBreakdownSummary: includes all components", () => {
    const summary = costBreakdownSummary(BREAKDOWN);
    expect(summary.base).toBe(4000);
    expect(summary.taxes).toBe(800);
    expect(summary.discounts).toBe(-400);
    expect(summary.total).toBe(4900);
  });

  it("grandTotal clamps to 0 with huge discounts", () => {
    const hugeDiscount = { ...BREAKDOWN, discounts: [{ name: "Full waiver", amountCents: 10000 }] };
    expect(grandTotal(hugeDiscount)).toBe(0);
  });
});
