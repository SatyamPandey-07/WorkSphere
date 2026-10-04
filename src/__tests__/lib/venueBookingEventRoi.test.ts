/**
 * Tests for venue booking event ROI (Return on Investment) calculation.
 */

interface EventCostBreakdown {
  venueCost: number;
  cateringCost: number;
  avTechCost: number;
  staffingCost: number;
  marketingCost: number;
  miscCost: number;
}

interface EventRevenue {
  ticketSales: number;
  sponsorships: number;
  exhibitorFees: number;
  merchandise: number;
  virtualTickets: number;
}

function totalCost(costs: EventCostBreakdown): number {
  return Math.round(Object.values(costs).reduce((s, c) => s + c, 0) * 100) / 100;
}

function totalRevenue(revenue: EventRevenue): number {
  return Math.round(Object.values(revenue).reduce((s, r) => s + r, 0) * 100) / 100;
}

function netProfit(costs: EventCostBreakdown, revenue: EventRevenue): number {
  return Math.round((totalRevenue(revenue) - totalCost(costs)) * 100) / 100;
}

function roi(costs: EventCostBreakdown, revenue: EventRevenue): number {
  const cost = totalCost(costs);
  if (cost === 0) return 0;
  return Math.round((netProfit(costs, revenue) / cost) * 100);
}

function breakEvenAttendees(costs: EventCostBreakdown, pricePerTicket: number): number {
  if (pricePerTicket === 0) return 0;
  return Math.ceil(totalCost(costs) / pricePerTicket);
}

function costPerAttendee(costs: EventCostBreakdown, attendeeCount: number): number {
  if (attendeeCount === 0) return 0;
  return Math.round((totalCost(costs) / attendeeCount) * 100) / 100;
}

const COSTS: EventCostBreakdown = {
  venueCost: 5000, cateringCost: 3000, avTechCost: 1500,
  staffingCost: 2000, marketingCost: 1000, miscCost: 500,
};
const REVENUE: EventRevenue = {
  ticketSales: 8000, sponsorships: 3000, exhibitorFees: 1500, merchandise: 500, virtualTickets: 1000,
};

describe("Event ROI calculation", () => {
  it("totalCost: $13000", () => {
    expect(totalCost(COSTS)).toBe(13000);
  });

  it("totalRevenue: $14000", () => {
    expect(totalRevenue(REVENUE)).toBe(14000);
  });

  it("netProfit: $14000 - $13000 = $1000", () => {
    expect(netProfit(COSTS, REVENUE)).toBe(1000);
  });

  it("roi: $1000 / $13000 = ~8%", () => {
    expect(roi(COSTS, REVENUE)).toBeGreaterThan(5);
    expect(roi(COSTS, REVENUE)).toBeLessThan(15);
  });

  it("breakEvenAttendees: $13000 / $50 ticket = 260 attendees", () => {
    expect(breakEvenAttendees(COSTS, 50)).toBe(260);
  });

  it("costPerAttendee: $13000 / 200 = $65", () => {
    expect(costPerAttendee(COSTS, 200)).toBe(65);
  });
});
