/**
 * Tests for booking upsell offer generation and eligibility.
 */

interface UpsellOffer {
  offerId: string;
  name: string;
  description: string;
  priceCents: number;
  type: "upgrade" | "addon" | "bundle";
  eligibleBookingTypes: string[];
  maxPerBooking: number;
}

interface BookingContext {
  bookingId: string;
  bookingType: string;
  durationHours: number;
  totalCents: number;
  addedOffers: string[];
}

function isOfferEligible(offer: UpsellOffer, ctx: BookingContext): boolean {
  if (!offer.eligibleBookingTypes.includes(ctx.bookingType)) return false;
  const alreadyAdded = ctx.addedOffers.filter((id) => id === offer.offerId).length;
  return alreadyAdded < offer.maxPerBooking;
}

function addOffer(ctx: BookingContext, offer: UpsellOffer): BookingContext {
  if (!isOfferEligible(offer, ctx)) throw new Error("Offer not eligible");
  return {
    ...ctx,
    addedOffers: [...ctx.addedOffers, offer.offerId],
    totalCents: ctx.totalCents + offer.priceCents,
  };
}

function totalUpsellValue(ctx: BookingContext, offers: UpsellOffer[]): number {
  return ctx.addedOffers.reduce((sum, id) => {
    const offer = offers.find((o) => o.offerId === id);
    return sum + (offer ? offer.priceCents : 0);
  }, 0);
}

const OFFERS: UpsellOffer[] = [
  { offerId: "o1", name: "Coffee Bundle",  description: "Coffee for 2h",  priceCents: 300, type: "addon",   eligibleBookingTypes: ["desk", "office"], maxPerBooking: 1 },
  { offerId: "o2", name: "Lunch Add-on",   description: "Lunch included",  priceCents: 1200,type: "addon",   eligibleBookingTypes: ["office"],          maxPerBooking: 1 },
  { offerId: "o3", name: "Print Credits",  description: "20 print pages",  priceCents: 200, type: "addon",   eligibleBookingTypes: ["desk", "office"],  maxPerBooking: 3 },
];

const CTX: BookingContext = {
  bookingId: "b1", bookingType: "desk",
  durationHours: 4, totalCents: 2000, addedOffers: [],
};

describe("Booking upsell offers", () => {
  it("isOfferEligible: coffee for desk booking → true", () => {
    expect(isOfferEligible(OFFERS[0], CTX)).toBe(true);
  });

  it("isOfferEligible: lunch for desk booking → false (only for office)", () => {
    expect(isOfferEligible(OFFERS[1], CTX)).toBe(false);
  });

  it("isOfferEligible: max reached → false", () => {
    const maxed = { ...CTX, addedOffers: ["o1"] };
    expect(isOfferEligible(OFFERS[0], maxed)).toBe(false);
  });

  it("addOffer: updates total and addedOffers", () => {
    const updated = addOffer(CTX, OFFERS[0]);
    expect(updated.totalCents).toBe(2300);
    expect(updated.addedOffers).toContain("o1");
  });

  it("addOffer: throws if not eligible", () => {
    expect(() => addOffer(CTX, OFFERS[1])).toThrow("not eligible");
  });

  it("totalUpsellValue: 0 for no offers", () => {
    expect(totalUpsellValue(CTX, OFFERS)).toBe(0);
  });

  it("totalUpsellValue: with offers added", () => {
    const withOffers = { ...CTX, addedOffers: ["o1", "o3"] };
    expect(totalUpsellValue(withOffers, OFFERS)).toBe(300 + 200);
  });
});
