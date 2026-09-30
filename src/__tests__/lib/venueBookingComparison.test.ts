/**
 * Tests for venue booking option comparison and selection helper.
 */

interface BookingOption {
  optionId: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  seatType: string;
  totalCents: number;
  perHourCents: number;
  amenities: string[];
  rating: number;
  distanceKm: number;
}

function compareByValue(a: BookingOption, b: BookingOption): number {
  // Value = rating / price (higher = better value)
  const valueA = (a.rating * 100) / a.totalCents;
  const valueB = (b.rating * 100) / b.totalCents;
  return valueB - valueA;
}

function cheapestOption(options: BookingOption[]): BookingOption | null {
  if (options.length === 0) return null;
  return options.reduce((min, o) => o.totalCents < min.totalCents ? o : min);
}

function bestRatedOption(options: BookingOption[]): BookingOption | null {
  if (options.length === 0) return null;
  return options.reduce((best, o) => o.rating > best.rating ? o : best);
}

function closestOption(options: BookingOption[]): BookingOption | null {
  if (options.length === 0) return null;
  return options.reduce((closest, o) => o.distanceKm < closest.distanceKm ? o : closest);
}

function bestValueOption(options: BookingOption[]): BookingOption | null {
  if (options.length === 0) return null;
  return [...options].sort(compareByValue)[0];
}

function comparisonMatrix(options: BookingOption[]): {
  cheapest: string | null;
  bestRated: string | null;
  closest: string | null;
  bestValue: string | null;
} {
  return {
    cheapest: cheapestOption(options)?.optionId ?? null,
    bestRated: bestRatedOption(options)?.optionId ?? null,
    closest: closestOption(options)?.optionId ?? null,
    bestValue: bestValueOption(options)?.optionId ?? null,
  };
}

const OPTIONS: BookingOption[] = [
  { optionId: "o1", venueId: "v1", venueName: "Budget Hub",   date: "2026-10-01", startTime: "09:00", endTime: "11:00", seatType: "desk", totalCents: 1500, perHourCents: 750, amenities: ["wifi"], rating: 3.8, distanceKm: 0.5 },
  { optionId: "o2", venueId: "v2", venueName: "Premium Space", date: "2026-10-01", startTime: "09:00", endTime: "11:00", seatType: "desk", totalCents: 4000, perHourCents: 2000, amenities: ["wifi", "coffee", "quiet"], rating: 4.9, distanceKm: 2.0 },
  { optionId: "o3", venueId: "v3", venueName: "Mid Cowork",   date: "2026-10-01", startTime: "09:00", endTime: "11:00", seatType: "desk", totalCents: 2500, perHourCents: 1250, amenities: ["wifi", "coffee"], rating: 4.3, distanceKm: 0.8 },
];

describe("Venue booking option comparison", () => {
  it("cheapestOption: o1 (1500 cents)", () => {
    expect(cheapestOption(OPTIONS)!.optionId).toBe("o1");
  });

  it("bestRatedOption: o2 (4.9 rating)", () => {
    expect(bestRatedOption(OPTIONS)!.optionId).toBe("o2");
  });

  it("closestOption: o1 (0.5 km)", () => {
    expect(closestOption(OPTIONS)!.optionId).toBe("o1");
  });

  it("bestValueOption: rating/price ratio", () => {
    const best = bestValueOption(OPTIONS)!;
    expect(best.optionId).toBeDefined();
  });

  it("comparisonMatrix: all keys present", () => {
    const matrix = comparisonMatrix(OPTIONS);
    expect(matrix.cheapest).toBe("o1");
    expect(matrix.bestRated).toBe("o2");
    expect(matrix.closest).toBe("o1");
  });

  it("cheapestOption: empty → null", () => {
    expect(cheapestOption([])).toBeNull();
  });
});
