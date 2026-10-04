/**
 * Tests for multi-location venue portfolio management utilities.
 */

interface VenueLocation {
  id: string;
  name: string;
  city: string;
  country: string;
  isActive: boolean;
  monthlyRevenue: number;
  capacity: number;
  occupancyRate: number;
  managerId: string;
}

function portfolioRevenue(venues: VenueLocation[]): number {
  return Math.round(venues.reduce((s, v) => s + v.monthlyRevenue, 0) * 100) / 100;
}

function activeVenues(venues: VenueLocation[]): VenueLocation[] {
  return venues.filter((v) => v.isActive);
}

function venuesByCountry(venues: VenueLocation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of venues) counts[v.country] = (counts[v.country] ?? 0) + 1;
  return counts;
}

function topRevenueVenues(venues: VenueLocation[], limit = 3): VenueLocation[] {
  return [...venues]
    .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue)
    .slice(0, limit);
}

function avgOccupancyRate(venues: VenueLocation[]): number {
  const active = activeVenues(venues);
  if (active.length === 0) return 0;
  return Math.round(active.reduce((s, v) => s + v.occupancyRate, 0) / active.length * 100) / 100;
}

function underperformingVenues(venues: VenueLocation[], threshold = 0.4): VenueLocation[] {
  return venues.filter((v) => v.isActive && v.occupancyRate < threshold);
}

const VENUES: VenueLocation[] = [
  { id: "v1", name: "London Central", city: "London",    country: "UK",  isActive: true,  monthlyRevenue: 45000, capacity: 300, occupancyRate: 0.82, managerId: "m1" },
  { id: "v2", name: "Paris East",     city: "Paris",     country: "FR",  isActive: true,  monthlyRevenue: 32000, capacity: 200, occupancyRate: 0.65, managerId: "m2" },
  { id: "v3", name: "Berlin Hub",     city: "Berlin",    country: "DE",  isActive: false, monthlyRevenue: 0,     capacity: 150, occupancyRate: 0,    managerId: "m3" },
  { id: "v4", name: "London West",    city: "London",    country: "UK",  isActive: true,  monthlyRevenue: 28000, capacity: 180, occupancyRate: 0.35, managerId: "m1" },
];

describe("Multi-location venue portfolio management", () => {
  it("portfolioRevenue: $105000 total", () => {
    expect(portfolioRevenue(VENUES)).toBe(105000);
  });

  it("activeVenues: 3 active venues", () => {
    expect(activeVenues(VENUES).length).toBe(3);
  });

  it("venuesByCountry: 2 UK venues", () => {
    expect(venuesByCountry(VENUES).UK).toBe(2);
  });

  it("topRevenueVenues: London Central is top", () => {
    expect(topRevenueVenues(VENUES, 1)[0].id).toBe("v1");
  });

  it("avgOccupancyRate: (0.82+0.65+0.35)/3 ≈ 0.61", () => {
    expect(avgOccupancyRate(VENUES)).toBeCloseTo(0.61, 1);
  });

  it("underperformingVenues: London West below 40%", () => {
    const under = underperformingVenues(VENUES);
    expect(under.map((v) => v.id)).toContain("v4");
  });
});
