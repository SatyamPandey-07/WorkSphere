/**
 * Tests for sponsored venue listing priority and budget management.
 */

interface SponsoredListing {
  venueId: string;
  dailyBudgetCents: number;
  spentTodayCents: number;
  bidPerClickCents: number;
  isActive: boolean;
  expiresAt: number;
}

function isSponsoredActive(listing: SponsoredListing, nowMs: number): boolean {
  if (!listing.isActive) return false;
  if (nowMs > listing.expiresAt) return false;
  return listing.spentTodayCents < listing.dailyBudgetCents;
}

function recordClick(listing: SponsoredListing): SponsoredListing {
  return { ...listing, spentTodayCents: listing.spentTodayCents + listing.bidPerClickCents };
}

function remainingBudget(listing: SponsoredListing): number {
  return Math.max(0, listing.dailyBudgetCents - listing.spentTodayCents);
}

function sortByBid(listings: SponsoredListing[], nowMs: number): SponsoredListing[] {
  return listings
    .filter((l) => isSponsoredActive(l, nowMs))
    .sort((a, b) => b.bidPerClickCents - a.bidPerClickCents);
}

const NOW = 1_700_000_000_000;
const LISTING: SponsoredListing = {
  venueId: "v1", dailyBudgetCents: 10000, spentTodayCents: 5000,
  bidPerClickCents: 100, isActive: true, expiresAt: NOW + 86400_000,
};

describe("Sponsored venue listing", () => {
  it("active within budget", () => {
    expect(isSponsoredActive(LISTING, NOW)).toBe(true);
  });

  it("inactive if isActive=false", () => {
    expect(isSponsoredActive({ ...LISTING, isActive: false }, NOW)).toBe(false);
  });

  it("inactive if budget exhausted", () => {
    expect(isSponsoredActive({ ...LISTING, spentTodayCents: 10000 }, NOW)).toBe(false);
  });

  it("inactive if expired", () => {
    expect(isSponsoredActive(LISTING, NOW + 90000_000)).toBe(false);
  });

  it("recordClick increments spent", () => {
    const updated = recordClick(LISTING);
    expect(updated.spentTodayCents).toBe(5100);
  });

  it("recordClick is immutable", () => {
    recordClick(LISTING);
    expect(LISTING.spentTodayCents).toBe(5000);
  });

  it("remainingBudget: 10000 - 5000 = 5000", () => {
    expect(remainingBudget(LISTING)).toBe(5000);
  });

  it("remainingBudget clamps to 0 when overspent", () => {
    expect(remainingBudget({ ...LISTING, spentTodayCents: 12000 })).toBe(0);
  });

  it("sortByBid: higher bid first", () => {
    const low  = { ...LISTING, venueId: "v2", bidPerClickCents: 50  };
    const high = { ...LISTING, venueId: "v3", bidPerClickCents: 200 };
    const sorted = sortByBid([LISTING, low, high], NOW);
    expect(sorted[0].venueId).toBe("v3");
  });
});
