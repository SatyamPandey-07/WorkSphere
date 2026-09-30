/**
 * Tests for venue price comparison widget logic.
 */

interface PriceOption {
  venueId: string;
  name: string;
  hourlyRateCents: number;
  totalCents: number;
  hours: number;
}

function cheapestOption(options: PriceOption[]): PriceOption | null {
  if (options.length === 0) return null;
  return options.reduce((min, o) => o.totalCents < min.totalCents ? o : min);
}

function mostExpensive(options: PriceOption[]): PriceOption | null {
  if (options.length === 0) return null;
  return options.reduce((max, o) => o.totalCents > max.totalCents ? o : max);
}

function savingsVsCheapest(option: PriceOption, options: PriceOption[]): number {
  const cheap = cheapestOption(options);
  if (!cheap) return 0;
  return Math.max(0, option.totalCents - cheap.totalCents);
}

function sortByTotal(options: PriceOption[]): PriceOption[] {
  return [...options].sort((a, b) => a.totalCents - b.totalCents);
}

function priceRange(options: PriceOption[]): { minCents: number; maxCents: number } | null {
  if (options.length === 0) return null;
  return {
    minCents: Math.min(...options.map((o) => o.totalCents)),
    maxCents: Math.max(...options.map((o) => o.totalCents)),
  };
}

const OPTIONS: PriceOption[] = [
  { venueId: "v1", name: "Budget Hub",  hourlyRateCents: 500,  totalCents: 2000,  hours: 4 },
  { venueId: "v2", name: "Mid Space",   hourlyRateCents: 1000, totalCents: 4000,  hours: 4 },
  { venueId: "v3", name: "Premium Hive",hourlyRateCents: 2000, totalCents: 8000,  hours: 4 },
];

describe("Price comparison widget", () => {
  it("cheapestOption returns lowest total", () => {
    expect(cheapestOption(OPTIONS)!.venueId).toBe("v1");
  });

  it("cheapestOption: empty → null", () => {
    expect(cheapestOption([])).toBeNull();
  });

  it("mostExpensive returns highest total", () => {
    expect(mostExpensive(OPTIONS)!.venueId).toBe("v3");
  });

  it("savingsVsCheapest: cheapest has 0 savings", () => {
    expect(savingsVsCheapest(OPTIONS[0], OPTIONS)).toBe(0);
  });

  it("savingsVsCheapest: mid option saves 2000 vs cheapest", () => {
    expect(savingsVsCheapest(OPTIONS[1], OPTIONS)).toBe(2000);
  });

  it("sortByTotal: cheapest first", () => {
    const sorted = sortByTotal(OPTIONS);
    expect(sorted[0].venueId).toBe("v1");
    expect(sorted[2].venueId).toBe("v3");
  });

  it("sortByTotal is immutable", () => {
    const original = OPTIONS.map((o) => o.venueId);
    sortByTotal(OPTIONS);
    expect(OPTIONS.map((o) => o.venueId)).toEqual(original);
  });

  it("priceRange: min 2000, max 8000", () => {
    const range = priceRange(OPTIONS)!;
    expect(range.minCents).toBe(2000);
    expect(range.maxCents).toBe(8000);
  });

  it("priceRange: empty → null", () => {
    expect(priceRange([])).toBeNull();
  });
});
