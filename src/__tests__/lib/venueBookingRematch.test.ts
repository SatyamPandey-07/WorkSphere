/**
 * Tests for alternative venue suggestion when original booking cancelled.
 */

interface VenueOption {
  venueId: string;
  name: string;
  distanceKm: number;
  availableSeats: number;
  priceCents: number;
  rating: number;
  similarityScore: number; // 0-1 (how similar to the original cancelled venue)
}

function filterEligibleRematch(
  options: VenueOption[],
  requiredSeats: number,
  maxDistanceKm: number,
  maxPriceCents: number
): VenueOption[] {
  return options.filter(
    (v) =>
      v.availableSeats >= requiredSeats &&
      v.distanceKm <= maxDistanceKm &&
      v.priceCents <= maxPriceCents
  );
}

function rematchScore(option: VenueOption): number {
  return option.similarityScore * 50 + option.rating * 10 - option.distanceKm * 2;
}

function sortedRematchOptions(options: VenueOption[]): VenueOption[] {
  return [...options].sort((a, b) => rematchScore(b) - rematchScore(a));
}

function bestRematch(options: VenueOption[]): VenueOption | null {
  if (options.length === 0) return null;
  return options.reduce((best, v) => rematchScore(v) > rematchScore(best) ? v : best);
}

const OPTIONS: VenueOption[] = [
  { venueId: "v1", name: "Hub A", distanceKm: 0.5, availableSeats: 10, priceCents: 1000, rating: 4.5, similarityScore: 0.9 },
  { venueId: "v2", name: "Hub B", distanceKm: 2.0, availableSeats: 5,  priceCents: 800,  rating: 4.0, similarityScore: 0.7 },
  { venueId: "v3", name: "Hub C", distanceKm: 0.2, availableSeats: 20, priceCents: 1500, rating: 4.8, similarityScore: 0.5 },
];

describe("Venue booking rematch", () => {
  it("filterEligibleRematch: all options pass basic filters", () => {
    const eligible = filterEligibleRematch(OPTIONS, 3, 5, 2000);
    expect(eligible).toHaveLength(3);
  });

  it("filterEligibleRematch: too expensive excluded", () => {
    const eligible = filterEligibleRematch(OPTIONS, 3, 5, 900);
    expect(eligible.map((v) => v.venueId)).not.toContain("v3");
  });

  it("filterEligibleRematch: insufficient seats excluded", () => {
    const eligible = filterEligibleRematch(OPTIONS, 8, 5, 2000);
    expect(eligible.map((v) => v.venueId)).not.toContain("v2");
  });

  it("rematchScore: high similarity + good rating = high score", () => {
    expect(rematchScore(OPTIONS[0])).toBeGreaterThan(rematchScore(OPTIONS[1]));
  });

  it("sortedRematchOptions: highest score first", () => {
    const sorted = sortedRematchOptions(OPTIONS);
    expect(rematchScore(sorted[0])).toBeGreaterThanOrEqual(rematchScore(sorted[1]));
  });

  it("bestRematch: returns highest score option", () => {
    const best = bestRematch(OPTIONS)!;
    expect(rematchScore(best)).toBeGreaterThanOrEqual(rematchScore(OPTIONS[1]));
  });

  it("bestRematch: empty → null", () => {
    expect(bestRematch([])).toBeNull();
  });
});
