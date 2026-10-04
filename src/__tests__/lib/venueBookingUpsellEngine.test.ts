/**
 * Tests for venue booking upsell and cross-sell recommendation engine.
 */

type UpsellCategory = "room_upgrade" | "add_on_service" | "extended_hours" | "premium_package" | "insurance";

interface UpsellOffer {
  id: string;
  category: UpsellCategory;
  title: string;
  price: number;
  originalValue: number;   // what it's worth vs buying separately
  relevanceScore: number;  // 0-1, how relevant to this booking
  acceptedByUser: boolean | null;
}

function offerDiscount(offer: UpsellOffer): number {
  if (offer.originalValue === 0) return 0;
  return Math.round(((offer.originalValue - offer.price) / offer.originalValue) * 100);
}

function sortOffersByValue(offers: UpsellOffer[]): UpsellOffer[] {
  return [...offers].sort((a, b) =>
    (b.relevanceScore * offerDiscount(b)) - (a.relevanceScore * offerDiscount(a))
  );
}

function acceptanceRate(offers: UpsellOffer[]): number {
  const decided = offers.filter((o) => o.acceptedByUser !== null);
  if (decided.length === 0) return 0;
  const accepted = decided.filter((o) => o.acceptedByUser === true).length;
  return Math.round((accepted / decided.length) * 100);
}

function totalUpsellRevenue(offers: UpsellOffer[]): number {
  return Math.round(offers.filter((o) => o.acceptedByUser === true).reduce((s, o) => s + o.price, 0) * 100) / 100;
}

function bestCategory(offers: UpsellOffer[]): UpsellCategory | null {
  const accepted = offers.filter((o) => o.acceptedByUser === true);
  if (accepted.length === 0) return null;
  const catRevenue: Partial<Record<UpsellCategory, number>> = {};
  for (const o of accepted) catRevenue[o.category] = (catRevenue[o.category] ?? 0) + o.price;
  return (Object.entries(catRevenue).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0]) as UpsellCategory;
}

const OFFERS: UpsellOffer[] = [
  { id: "u1", category: "room_upgrade",    title: "Upgrade to Suite", price: 200, originalValue: 300, relevanceScore: 0.9, acceptedByUser: true },
  { id: "u2", category: "add_on_service",  title: "Catering Package", price: 150, originalValue: 180, relevanceScore: 0.7, acceptedByUser: false },
  { id: "u3", category: "extended_hours",  title: "+2 Hours",         price: 100, originalValue: 150, relevanceScore: 0.8, acceptedByUser: null },
  { id: "u4", category: "insurance",       title: "Event Insurance",  price: 50,  originalValue: 80,  relevanceScore: 0.5, acceptedByUser: true },
];

describe("Upsell and cross-sell engine", () => {
  it("offerDiscount: $200 offer, $300 value = 33% off", () => {
    expect(offerDiscount(OFFERS[0])).toBe(33);
  });

  it("sortOffersByValue: highest relevance×discount first", () => {
    const sorted = sortOffersByValue(OFFERS);
    expect(sorted.length).toBe(4);
    // Room upgrade has highest relevance*discount
    expect(sorted[0].id).toBe("u1");
  });

  it("acceptanceRate: 2 decided, 1 accepted = 50%", () => {
    expect(acceptanceRate(OFFERS.filter((o) => o.acceptedByUser !== null))).toBe(50);
  });

  it("totalUpsellRevenue: u1 + u4 = $250", () => {
    expect(totalUpsellRevenue(OFFERS)).toBe(250);
  });

  it("bestCategory: room_upgrade earns most", () => {
    expect(bestCategory(OFFERS)).toBe("room_upgrade");
  });
});
