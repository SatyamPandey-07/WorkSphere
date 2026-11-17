import {
  calculateCarbonOffsetSummary,
  calculateCommuteOffset,
} from "@/lib/sustainability/carbonCalculator";

describe("commute carbon offset calculator", () => {
  it("uses the configured gasoline baseline for walking and cycling", () => {
    expect(calculateCommuteOffset(10, "walking").co2SavedKg).toBe(1.7);
    expect(calculateCommuteOffset(5, "cycling").co2SavedKg).toBe(0.85);
  });

  it("subtracts public-transit and electric-vehicle emissions from the baseline", () => {
    expect(calculateCommuteOffset(10, "public_transit").co2SavedKg).toBe(1.1);
    expect(calculateCommuteOffset(10, "electric_vehicle").co2SavedKg).toBe(1.2);
    expect(calculateCommuteOffset(10, "gasoline_car").co2SavedKg).toBe(0);
  });

  it("treats negative, non-finite, and non-positive distances as zero", () => {
    expect(calculateCommuteOffset(-10, "walking").co2SavedKg).toBe(0);
    expect(calculateCommuteOffset(Number.NaN, "cycling").co2SavedKg).toBe(0);
    expect(calculateCommuteOffset(Number.POSITIVE_INFINITY, "walking").distanceKm).toBe(0);
  });

  it("aggregates trip distance, saved CO2, and approximate tree equivalents", () => {
    const summary = calculateCarbonOffsetSummary([
      { distanceKm: 10, mode: "walking" },
      { distanceKm: 5, mode: "cycling" },
    ]);

    expect(summary.totalDistanceKm).toBe(15);
    expect(summary.co2SavedKg).toBe(2.55);
    expect(summary.treesEquivalent).toBeCloseTo(2.55 / 21, 4);
    expect(summary.tripCount).toBe(2);
  });
});
