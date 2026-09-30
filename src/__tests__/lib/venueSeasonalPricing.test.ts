/**
 * Tests for venue seasonal pricing adjustments.
 */

type Season = "spring" | "summer" | "fall" | "winter";

function getSeason(monthNumber: number): Season {
  if (monthNumber >= 3 && monthNumber <= 5)  return "spring";
  if (monthNumber >= 6 && monthNumber <= 8)  return "summer";
  if (monthNumber >= 9 && monthNumber <= 11) return "fall";
  return "winter";
}

const SEASONAL_MULTIPLIERS: Record<Season, number> = {
  spring: 1.0,
  summer: 1.3,
  fall:   1.1,
  winter: 0.9,
};

function seasonalPrice(baseCents: number, month: number): number {
  const season = getSeason(month);
  return Math.round(baseCents * SEASONAL_MULTIPLIERS[season]);
}

function cheapestMonth(baseCents: number): number {
  let minPrice = Infinity;
  let minMonth = 1;
  for (let m = 1; m <= 12; m++) {
    const price = seasonalPrice(baseCents, m);
    if (price < minPrice) { minPrice = price; minMonth = m; }
  }
  return minMonth;
}

describe("Venue seasonal pricing", () => {
  it("March is spring", () => {
    expect(getSeason(3)).toBe("spring");
  });

  it("June is summer", () => {
    expect(getSeason(6)).toBe("summer");
  });

  it("September is fall", () => {
    expect(getSeason(9)).toBe("fall");
  });

  it("December is winter", () => {
    expect(getSeason(12)).toBe("winter");
  });

  it("January is winter", () => {
    expect(getSeason(1)).toBe("winter");
  });

  it("summer price 30% higher than spring", () => {
    expect(seasonalPrice(1000, 7)).toBe(1300);
    expect(seasonalPrice(1000, 4)).toBe(1000);
  });

  it("winter price 10% lower", () => {
    expect(seasonalPrice(1000, 1)).toBe(900);
  });

  it("fall price 10% higher", () => {
    expect(seasonalPrice(1000, 10)).toBe(1100);
  });

  it("cheapest month is in winter", () => {
    expect(getSeason(cheapestMonth(1000))).toBe("winter");
  });
});
