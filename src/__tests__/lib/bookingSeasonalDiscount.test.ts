/**
 * Tests for booking seasonal discount campaign management.
 */

interface SeasonalDiscount {
  campaignId: string;
  name: string;
  discountPct: number;
  startDate: string;  // YYYY-MM-DD
  endDate: string;
  applicableCategories: string[];
  minBookingHours: number;
  stacksWithOtherDiscounts: boolean;
}

function isDiscountActive(discount: SeasonalDiscount, bookingDate: string): boolean {
  return bookingDate >= discount.startDate && bookingDate <= discount.endDate;
}

function isDiscountApplicable(
  discount: SeasonalDiscount,
  bookingDate: string,
  venueCategory: string,
  bookingHours: number
): boolean {
  if (!isDiscountActive(discount, bookingDate)) return false;
  if (!discount.applicableCategories.includes(venueCategory)) return false;
  if (bookingHours < discount.minBookingHours) return false;
  return true;
}

function applySeasonalDiscount(baseCents: number, discount: SeasonalDiscount): number {
  return Math.round(baseCents * (1 - discount.discountPct / 100));
}

function bestDiscount(
  discounts: SeasonalDiscount[],
  bookingDate: string,
  venueCategory: string,
  bookingHours: number,
  baseCents: number
): { campaignId: string; finalCents: number } | null {
  const applicable = discounts.filter((d) =>
    isDiscountApplicable(d, bookingDate, venueCategory, bookingHours)
  );
  if (applicable.length === 0) return null;
  const best = applicable.reduce((max, d) => d.discountPct > max.discountPct ? d : max);
  return { campaignId: best.campaignId, finalCents: applySeasonalDiscount(baseCents, best) };
}

const DISCOUNTS: SeasonalDiscount[] = [
  { campaignId: "d1", name: "Summer Sale",    discountPct: 15, startDate: "2026-06-01", endDate: "2026-08-31", applicableCategories: ["cafe", "coworking"], minBookingHours: 2, stacksWithOtherDiscounts: false },
  { campaignId: "d2", name: "October Promo",  discountPct: 20, startDate: "2026-10-01", endDate: "2026-10-31", applicableCategories: ["coworking"],         minBookingHours: 4, stacksWithOtherDiscounts: true  },
  { campaignId: "d3", name: "Weekend Deal",   discountPct: 10, startDate: "2026-10-01", endDate: "2026-10-31", applicableCategories: ["cafe", "coworking"], minBookingHours: 1, stacksWithOtherDiscounts: true  },
];

describe("Booking seasonal discount campaigns", () => {
  it("isDiscountActive: Oct 15 in October Promo → true", () => {
    expect(isDiscountActive(DISCOUNTS[1], "2026-10-15")).toBe(true);
  });

  it("isDiscountActive: Sept outside October Promo → false", () => {
    expect(isDiscountActive(DISCOUNTS[1], "2026-09-30")).toBe(false);
  });

  it("isDiscountApplicable: coworking 5h in October → true for d2", () => {
    expect(isDiscountApplicable(DISCOUNTS[1], "2026-10-15", "coworking", 5)).toBe(true);
  });

  it("isDiscountApplicable: too few hours → false", () => {
    expect(isDiscountApplicable(DISCOUNTS[1], "2026-10-15", "coworking", 2)).toBe(false);
  });

  it("bestDiscount: October coworking 5h = 20% off (d2 is better than d3)", () => {
    const result = bestDiscount(DISCOUNTS, "2026-10-15", "coworking", 5, 10_000);
    expect(result!.campaignId).toBe("d2");
    expect(result!.finalCents).toBe(8_000);
  });

  it("bestDiscount: no applicable discount → null", () => {
    expect(bestDiscount(DISCOUNTS, "2026-11-01", "coworking", 5, 10_000)).toBeNull();
  });

  it("applySeasonalDiscount: 20% off 10000 = 8000", () => {
    expect(applySeasonalDiscount(10_000, DISCOUNTS[1])).toBe(8_000);
  });
});
