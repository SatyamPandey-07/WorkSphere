/**
 * Tests for venue space portfolio management (multiple space types).
 */

interface SpacePortfolioItem {
  spaceId: string;
  venueId: string;
  type: string;
  name: string;
  capacity: number;
  hourlyRateCents: number;
  monthlyBookings: number;
  avgOccupancyPct: number;
  revenueThisMonthCents: number;
}

function portfolioRevenue(portfolio: SpacePortfolioItem[], venueId: string): number {
  return portfolio
    .filter((s) => s.venueId === venueId)
    .reduce((sum, s) => sum + s.revenueThisMonthCents, 0);
}

function bestPerformingSpace(portfolio: SpacePortfolioItem[], venueId: string): SpacePortfolioItem | null {
  const venue = portfolio.filter((s) => s.venueId === venueId);
  if (venue.length === 0) return null;
  return venue.reduce((best, s) => s.revenueThisMonthCents > best.revenueThisMonthCents ? s : best);
}

function underperformingSpaces(
  portfolio: SpacePortfolioItem[],
  venueId: string,
  minOccupancyPct = 40
): SpacePortfolioItem[] {
  return portfolio.filter(
    (s) => s.venueId === venueId && s.avgOccupancyPct < minOccupancyPct
  );
}

function portfolioDiversification(portfolio: SpacePortfolioItem[], venueId: string): number {
  const types = new Set(portfolio.filter((s) => s.venueId === venueId).map((s) => s.type));
  return types.size;
}

function revenueContribution(space: SpacePortfolioItem, portfolio: SpacePortfolioItem[]): number {
  const total = portfolioRevenue(portfolio, space.venueId);
  if (total === 0) return 0;
  return Math.round((space.revenueThisMonthCents / total) * 100);
}

const PORTFOLIO: SpacePortfolioItem[] = [
  { spaceId: "sp1", venueId: "v1", type: "hot_desk",     name: "Open Area",    capacity: 20, hourlyRateCents: 500,  monthlyBookings: 80, avgOccupancyPct: 70, revenueThisMonthCents: 40_000 },
  { spaceId: "sp2", venueId: "v1", type: "meeting_room", name: "Board Room",   capacity: 8,  hourlyRateCents: 2000, monthlyBookings: 15, avgOccupancyPct: 30, revenueThisMonthCents: 30_000 },
  { spaceId: "sp3", venueId: "v1", type: "phone_booth",  name: "Call Booths",  capacity: 1,  hourlyRateCents: 300,  monthlyBookings: 100,avgOccupancyPct: 85, revenueThisMonthCents: 15_000 },
  { spaceId: "sp4", venueId: "v2", type: "event_hall",   name: "Main Hall",    capacity: 200,hourlyRateCents: 5000, monthlyBookings: 5,  avgOccupancyPct: 90, revenueThisMonthCents: 100_000 },
];

describe("Venue space portfolio", () => {
  it("portfolioRevenue: v1 = 40000+30000+15000 = 85000", () => {
    expect(portfolioRevenue(PORTFOLIO, "v1")).toBe(85_000);
  });

  it("bestPerformingSpace: v1 = sp1 (most revenue)", () => {
    expect(bestPerformingSpace(PORTFOLIO, "v1")!.spaceId).toBe("sp1");
  });

  it("underperformingSpaces: sp2 below 40% → listed", () => {
    const under = underperformingSpaces(PORTFOLIO, "v1");
    expect(under.map((s) => s.spaceId)).toContain("sp2");
  });

  it("underperformingSpaces: sp3 (85% occupancy) not underperforming", () => {
    const under = underperformingSpaces(PORTFOLIO, "v1");
    expect(under.map((s) => s.spaceId)).not.toContain("sp3");
  });

  it("portfolioDiversification: v1 has 3 different types", () => {
    expect(portfolioDiversification(PORTFOLIO, "v1")).toBe(3);
  });

  it("revenueContribution: sp1 = 40000/85000 ≈ 47%", () => {
    expect(revenueContribution(PORTFOLIO[0], PORTFOLIO)).toBeCloseTo(47, 0);
  });
});
