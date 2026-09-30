/**
 * Tests for venue multi-location (chain) management.
 */

interface VenueLocation {
  locationId: string;
  chainId: string;
  city: string;
  country: string;
  isOpen: boolean;
  avgRating: number;
  monthlyRevenueCents: number;
}

function locationsInCity(locations: VenueLocation[], chainId: string, city: string): VenueLocation[] {
  return locations.filter((l) => l.chainId === chainId && l.city.toLowerCase() === city.toLowerCase());
}

function chainTotalRevenue(locations: VenueLocation[], chainId: string): number {
  return locations
    .filter((l) => l.chainId === chainId && l.isOpen)
    .reduce((sum, l) => sum + l.monthlyRevenueCents, 0);
}

function chainAvgRating(locations: VenueLocation[], chainId: string): number {
  const chain = locations.filter((l) => l.chainId === chainId && l.isOpen);
  if (chain.length === 0) return 0;
  return Math.round((chain.reduce((s, l) => s + l.avgRating, 0) / chain.length) * 10) / 10;
}

function bestPerformingLocation(locations: VenueLocation[], chainId: string): VenueLocation | null {
  const chain = locations.filter((l) => l.chainId === chainId && l.isOpen);
  if (chain.length === 0) return null;
  return chain.reduce((best, l) => l.monthlyRevenueCents > best.monthlyRevenueCents ? l : best);
}

function underperformingLocations(
  locations: VenueLocation[],
  chainId: string,
  minRevenueCents: number
): VenueLocation[] {
  return locations.filter(
    (l) => l.chainId === chainId && l.isOpen && l.monthlyRevenueCents < minRevenueCents
  );
}

const LOCATIONS: VenueLocation[] = [
  { locationId: "l1", chainId: "ch1", city: "New York",  country: "US", isOpen: true,  avgRating: 4.5, monthlyRevenueCents: 50_000 },
  { locationId: "l2", chainId: "ch1", city: "Boston",    country: "US", isOpen: true,  avgRating: 4.2, monthlyRevenueCents: 30_000 },
  { locationId: "l3", chainId: "ch1", city: "New York",  country: "US", isOpen: false, avgRating: 4.0, monthlyRevenueCents: 0      }, // closed
  { locationId: "l4", chainId: "ch2", city: "London",    country: "UK", isOpen: true,  avgRating: 4.7, monthlyRevenueCents: 80_000 },
];

describe("Venue multi-location chain management", () => {
  it("locationsInCity: ch1 has 2 in New York (including closed)", () => {
    expect(locationsInCity(LOCATIONS, "ch1", "New York")).toHaveLength(2);
  });

  it("chainTotalRevenue: ch1 open only = 50000+30000 = 80000", () => {
    expect(chainTotalRevenue(LOCATIONS, "ch1")).toBe(80_000);
  });

  it("chainAvgRating: ch1 open = (4.5+4.2)/2 = 4.35", () => {
    expect(chainAvgRating(LOCATIONS, "ch1")).toBeCloseTo(4.35, 1);
  });

  it("chainAvgRating: no open locations → 0", () => {
    const closed = LOCATIONS.map((l) => ({ ...l, isOpen: false }));
    expect(chainAvgRating(closed, "ch1")).toBe(0);
  });

  it("bestPerformingLocation: l1 (50000) for ch1", () => {
    expect(bestPerformingLocation(LOCATIONS, "ch1")!.locationId).toBe("l1");
  });

  it("underperformingLocations: l2 below 40000 threshold", () => {
    const under = underperformingLocations(LOCATIONS, "ch1", 40_000);
    expect(under.map((l) => l.locationId)).toContain("l2");
    expect(under.map((l) => l.locationId)).not.toContain("l3"); // closed excluded
  });
});
