/**
 * Tests for venue booking cross-sell recommendations to other venues.
 */

interface CrossSellVenue {
  venueId: string;
  name: string;
  chainId?: string;
  partnershipLevel: "none" | "affiliate" | "preferred" | "owned";
  commissionPct: number;
  category: string;
  location: { lat: number; lng: number };
}

interface BookingContext {
  currentVenueId: string;
  date: string;
  requestedCategory?: string;
  userLocation?: { lat: number; lng: number };
  totalBookingCents: number;
}

function isEligibleForCrossSell(venue: CrossSellVenue, ctx: BookingContext): boolean {
  if (venue.venueId === ctx.currentVenueId) return false; // don't cross-sell to same venue
  if (venue.partnershipLevel === "none") return false;
  if (ctx.requestedCategory && venue.category !== ctx.requestedCategory) return false;
  return true;
}

function crossSellCommission(venue: CrossSellVenue, bookingCents: number): number {
  return Math.round(bookingCents * (venue.commissionPct / 100));
}

function rankedCrossSellVenues(
  venues: CrossSellVenue[],
  ctx: BookingContext
): CrossSellVenue[] {
  const eligible = venues.filter((v) => isEligibleForCrossSell(v, ctx));
  const partnershipOrder = { owned: 0, preferred: 1, affiliate: 2 };
  return eligible.sort((a, b) => partnershipOrder[a.partnershipLevel] - partnershipOrder[b.partnershipLevel]);
}

function estimateCrossSellRevenue(venues: CrossSellVenue[], avgBookingCents: number): number {
  return venues
    .filter((v) => v.partnershipLevel !== "none")
    .reduce((sum, v) => sum + crossSellCommission(v, avgBookingCents), 0);
}

const VENUES: CrossSellVenue[] = [
  { venueId: "v1", name: "Current Venue", chainId: "ch1", partnershipLevel: "owned",     commissionPct: 0,   category: "coworking", location: { lat: 40.7, lng: -74.0 } },
  { venueId: "v2", name: "Partner Hub",   chainId: "ch1", partnershipLevel: "preferred",  commissionPct: 8,   category: "coworking", location: { lat: 40.8, lng: -74.1 } },
  { venueId: "v3", name: "Affiliate Café",chainId: undefined, partnershipLevel: "affiliate",  commissionPct: 5,   category: "cafe",      location: { lat: 40.7, lng: -74.0 } },
  { venueId: "v4", name: "No Deal Spot",  chainId: undefined, partnershipLevel: "none",       commissionPct: 0,   category: "coworking", location: { lat: 41.0, lng: -74.5 } },
];

const CTX: BookingContext = {
  currentVenueId: "v1", date: "2026-10-01",
  totalBookingCents: 5000,
};

describe("Venue booking cross-sell recommendations", () => {
  it("isEligibleForCrossSell: current venue excluded", () => {
    expect(isEligibleForCrossSell(VENUES[0], CTX)).toBe(false);
  });

  it("isEligibleForCrossSell: no partnership → false", () => {
    expect(isEligibleForCrossSell(VENUES[3], CTX)).toBe(false);
  });

  it("isEligibleForCrossSell: preferred partner → true", () => {
    expect(isEligibleForCrossSell(VENUES[1], CTX)).toBe(true);
  });

  it("isEligibleForCrossSell: wrong category filtered out", () => {
    const cafeOnly = { ...CTX, requestedCategory: "coworking" };
    expect(isEligibleForCrossSell(VENUES[2], cafeOnly)).toBe(false);
  });

  it("crossSellCommission: 8% of 5000 = 400", () => {
    expect(crossSellCommission(VENUES[1], 5000)).toBe(400);
  });

  it("rankedCrossSellVenues: preferred before affiliate", () => {
    const ranked = rankedCrossSellVenues(VENUES, CTX);
    expect(ranked[0].venueId).toBe("v2"); // preferred ranked first
  });

  it("estimateCrossSellRevenue: includes all partners", () => {
    const revenue = estimateCrossSellRevenue(VENUES, 5000);
    expect(revenue).toBe(400 + 250); // v2: 8% + v3: 5%
  });
});
