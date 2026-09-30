/**
 * Tests for booking price negotiation between venue and user.
 */

type NegotiationStatus = "proposed" | "counter_offered" | "accepted" | "rejected" | "expired";

interface PriceNegotiation {
  negotiationId: string;
  bookingId: string;
  userId: string;
  venueId: string;
  originalPriceCents: number;
  proposedPriceCents: number;
  counterPriceCents: number | null;
  status: NegotiationStatus;
  expiresAt: number;
  reason: string;
}

function canNegotiate(
  originalCents: number,
  proposedCents: number,
  maxDiscountPct = 20
): boolean {
  if (proposedCents >= originalCents) return false; // must be lower
  const discountPct = ((originalCents - proposedCents) / originalCents) * 100;
  return discountPct <= maxDiscountPct;
}

function counterOffer(
  negotiation: PriceNegotiation,
  counterCents: number,
  nowMs: number,
  offerWindowMs = 86_400_000
): PriceNegotiation {
  if (negotiation.status !== "proposed") throw new Error("Can only counter-offer a pending proposal");
  return {
    ...negotiation,
    counterPriceCents: counterCents,
    status: "counter_offered",
    expiresAt: nowMs + offerWindowMs,
  };
}

function acceptNegotiation(negotiation: PriceNegotiation, nowMs: number): PriceNegotiation {
  if (nowMs >= negotiation.expiresAt) throw new Error("Negotiation expired");
  if (negotiation.status !== "proposed" && negotiation.status !== "counter_offered") {
    throw new Error("Cannot accept in current status");
  }
  return { ...negotiation, status: "accepted" };
}

function finalPrice(negotiation: PriceNegotiation): number {
  if (negotiation.status !== "accepted") return negotiation.originalPriceCents;
  return negotiation.counterPriceCents ?? negotiation.proposedPriceCents;
}

const NOW = 1_700_000_000_000;
const NEG: PriceNegotiation = {
  negotiationId: "n1", bookingId: "b1", userId: "u1", venueId: "v1",
  originalPriceCents: 10_000, proposedPriceCents: 8_500, counterPriceCents: null,
  status: "proposed", expiresAt: NOW + 86_400_000, reason: "budget constraint",
};

describe("Booking price negotiation", () => {
  it("canNegotiate: 15% discount → true", () => {
    expect(canNegotiate(10_000, 8_500)).toBe(true);
  });

  it("canNegotiate: 25% exceeds max → false", () => {
    expect(canNegotiate(10_000, 7_500)).toBe(false);
  });

  it("canNegotiate: proposed >= original → false", () => {
    expect(canNegotiate(10_000, 10_000)).toBe(false);
  });

  it("counterOffer: sets counter price and status", () => {
    const countered = counterOffer(NEG, 9_000, NOW);
    expect(countered.counterPriceCents).toBe(9_000);
    expect(countered.status).toBe("counter_offered");
  });

  it("counterOffer: throws if not proposed", () => {
    const accepted = { ...NEG, status: "accepted" as NegotiationStatus };
    expect(() => counterOffer(accepted, 9_000, NOW)).toThrow();
  });

  it("acceptNegotiation: accepts proposal", () => {
    const accepted = acceptNegotiation(NEG, NOW);
    expect(accepted.status).toBe("accepted");
  });

  it("acceptNegotiation: throws when expired", () => {
    expect(() => acceptNegotiation(NEG, NOW + 2 * 86_400_000)).toThrow("expired");
  });

  it("finalPrice: accepted proposal → proposedPrice", () => {
    const accepted = acceptNegotiation(NEG, NOW);
    expect(finalPrice(accepted)).toBe(8_500);
  });

  it("finalPrice: not accepted → originalPrice", () => {
    expect(finalPrice(NEG)).toBe(10_000);
  });
});
