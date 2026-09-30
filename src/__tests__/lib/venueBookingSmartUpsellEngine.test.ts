/**
 * Tests for smart upsell engine with ML-based recommendations.
 */

interface UpsellCandidateItem {
  itemId: string;
  name: string;
  priceCents: number;
  category: string;
  historicalAcceptanceRate: number; // 0-1
  affinity: number;                  // 0-1 match to user preferences
}

function upsellScore(item: UpsellCandidateItem, bookingValueCents: number): number {
  const priceRatio = Math.min(item.priceCents / bookingValueCents, 0.5); // max 50% of booking value
  const relativeValue = (1 - priceRatio) * 40; // lower relative price = better
  const acceptance = item.historicalAcceptanceRate * 35;
  const affinity = item.affinity * 25;
  return Math.round(relativeValue + acceptance + affinity);
}

function topUpsellItems(
  candidates: UpsellCandidateItem[],
  bookingValueCents: number,
  maxItems = 3
): UpsellCandidateItem[] {
  return [...candidates]
    .sort((a, b) => upsellScore(b, bookingValueCents) - upsellScore(a, bookingValueCents))
    .slice(0, maxItems);
}

function upsellRevenueExpectation(
  items: UpsellCandidateItem[],
  showCount: number
): number {
  // Expected revenue = price * acceptance rate (shown to X users)
  return Math.round(
    items.reduce((s, item) => s + item.priceCents * item.historicalAcceptanceRate * showCount, 0)
  );
}

function filterByBudgetFit(
  items: UpsellCandidateItem[],
  bookingCents: number,
  maxRatioPct = 30
): UpsellCandidateItem[] {
  const maxAddOnCents = Math.round(bookingCents * (maxRatioPct / 100));
  return items.filter((i) => i.priceCents <= maxAddOnCents);
}

const CANDIDATES: UpsellCandidateItem[] = [
  { itemId: "u1", name: "Coffee Bundle",  priceCents: 500,  category: "food",    historicalAcceptanceRate: 0.65, affinity: 0.8 },
  { itemId: "u2", name: "Projector Rental",priceCents: 1500, category: "tech",    historicalAcceptanceRate: 0.30, affinity: 0.7 },
  { itemId: "u3", name: "Parking Voucher", priceCents: 800,  category: "parking", historicalAcceptanceRate: 0.45, affinity: 0.5 },
  { itemId: "u4", name: "Catering Lunch",  priceCents: 3000, category: "food",    historicalAcceptanceRate: 0.20, affinity: 0.6 },
];

describe("Smart upsell engine", () => {
  it("upsellScore: coffee (high acceptance + affinity) scores well", () => {
    const coffee = upsellScore(CANDIDATES[0], 5000);
    const projector = upsellScore(CANDIDATES[1], 5000);
    expect(coffee).toBeGreaterThan(projector);
  });

  it("topUpsellItems: returns top 3 by score", () => {
    const top = topUpsellItems(CANDIDATES, 5000, 3);
    expect(top).toHaveLength(3);
  });

  it("filterByBudgetFit: max 30% of 5000 = 1500 max", () => {
    const filtered = filterByBudgetFit(CANDIDATES, 5000, 30);
    expect(filtered.every((i) => i.priceCents <= 1500)).toBe(true);
    expect(filtered.map((i) => i.itemId)).not.toContain("u4"); // 3000 > 1500
  });

  it("upsellRevenueExpectation: coffee shown to 100 users", () => {
    const expected = upsellRevenueExpectation([CANDIDATES[0]], 100);
    expect(expected).toBe(Math.round(500 * 0.65 * 100)); // 32500
  });
});
