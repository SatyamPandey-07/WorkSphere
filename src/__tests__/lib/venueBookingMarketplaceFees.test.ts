/**
 * Tests for venue marketplace fee structure and revenue sharing.
 */

type FeeType = "platform" | "payment_processing" | "insurance" | "premium_listing" | "instant_book";

interface FeeStructure {
  type: FeeType;
  rate: number;      // 0-1 for percentage, or flat amount if isFlat=true
  isFlat: boolean;
  paidBy: "venue" | "guest" | "split";
  appliesTo: "all" | "basic" | "premium" | "enterprise";
}

interface BookingFees {
  bookingId: string;
  subtotal: number;
  planTier: "basic" | "premium" | "enterprise";
  appliedFees: { type: FeeType; amount: number; paidBy: "venue" | "guest" }[];
}

const FEE_STRUCTURES: FeeStructure[] = [
  { type: "platform",           rate: 0.05, isFlat: false, paidBy: "venue",  appliesTo: "basic" },
  { type: "platform",           rate: 0.03, isFlat: false, paidBy: "venue",  appliesTo: "premium" },
  { type: "platform",           rate: 0.015,isFlat: false, paidBy: "venue",  appliesTo: "enterprise" },
  { type: "payment_processing", rate: 0.029,isFlat: false, paidBy: "split",  appliesTo: "all" },
  { type: "insurance",          rate: 0.01, isFlat: false, paidBy: "guest",  appliesTo: "all" },
  { type: "premium_listing",    rate: 50,   isFlat: true,  paidBy: "venue",  appliesTo: "all" },
];

function platformFeeRate(tier: "basic" | "premium" | "enterprise"): number {
  const fee = FEE_STRUCTURES.find((f) => f.type === "platform" && (f.appliesTo === tier || f.appliesTo === "all"));
  return fee?.rate ?? 0;
}

function calculateFee(subtotal: number, fee: FeeStructure): number {
  if (fee.isFlat) return fee.rate;
  return Math.round(subtotal * fee.rate * 100) / 100;
}

function venueFees(subtotal: number, tier: "basic" | "premium" | "enterprise"): number {
  const applicable = FEE_STRUCTURES.filter(
    (f) => (f.appliesTo === tier || f.appliesTo === "all") &&
      (f.paidBy === "venue" || f.paidBy === "split")
  );
  return Math.round(applicable.reduce((s, f) => s + calculateFee(subtotal, f), 0) * 100) / 100;
}

function guestFees(subtotal: number): number {
  const applicable = FEE_STRUCTURES.filter(
    (f) => f.paidBy === "guest" || f.paidBy === "split"
  );
  return Math.round(applicable.reduce((s, f) => s + calculateFee(subtotal, f), 0) * 100) / 100;
}

function netVenueRevenue(subtotal: number, tier: "basic" | "premium" | "enterprise"): number {
  return Math.round((subtotal - venueFees(subtotal, tier)) * 100) / 100;
}

describe("Marketplace fee structure", () => {
  it("platformFeeRate: basic = 5%", () => {
    expect(platformFeeRate("basic")).toBe(0.05);
  });

  it("platformFeeRate: enterprise = 1.5%", () => {
    expect(platformFeeRate("enterprise")).toBe(0.015);
  });

  it("venueFees: basic plan on $1000 booking", () => {
    const fees = venueFees(1000, "basic");
    expect(fees).toBeGreaterThan(50);  // platform 5% + payment split + flat
  });

  it("netVenueRevenue: enterprise gets higher net than basic", () => {
    const basic = netVenueRevenue(1000, "basic");
    const enterprise = netVenueRevenue(1000, "enterprise");
    expect(enterprise).toBeGreaterThan(basic);
  });

  it("guestFees: guest pays insurance + payment split", () => {
    expect(guestFees(1000)).toBeGreaterThan(0);
  });

  it("calculateFee: flat fee of $50 premium listing", () => {
    const flatFee = FEE_STRUCTURES.find((f) => f.type === "premium_listing")!;
    expect(calculateFee(1000, flatFee)).toBe(50);
  });
});
