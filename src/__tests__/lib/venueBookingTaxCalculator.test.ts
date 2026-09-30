/**
 * Tests for venue booking tax calculation across jurisdictions.
 */

type TaxType = "vat" | "gst" | "sales_tax" | "service_tax" | "entertainment_tax";

interface TaxRule {
  jurisdiction: string;
  type: TaxType;
  rate: number;           // 0-1 (e.g. 0.2 = 20%)
  appliesTo: string[];    // booking types it applies to
  isCompound: boolean;    // whether applied on top of other taxes
}

interface BookingForTax {
  id: string;
  type: string;
  subtotal: number;
  jurisdiction: string;
}

const TAX_RULES: TaxRule[] = [
  { jurisdiction: "UK",    type: "vat",             rate: 0.20, appliesTo: ["venue_hire", "catering"], isCompound: false },
  { jurisdiction: "IN",    type: "gst",             rate: 0.18, appliesTo: ["venue_hire"],             isCompound: false },
  { jurisdiction: "IN",    type: "service_tax",     rate: 0.05, appliesTo: ["venue_hire"],             isCompound: true },
  { jurisdiction: "US_CA", type: "sales_tax",       rate: 0.10, appliesTo: ["venue_hire", "catering"], isCompound: false },
];

function applicableTaxes(booking: BookingForTax): TaxRule[] {
  return TAX_RULES.filter(
    (r) => r.jurisdiction === booking.jurisdiction && r.appliesTo.includes(booking.type)
  );
}

function totalTaxAmount(booking: BookingForTax): number {
  const applicable = applicableTaxes(booking);
  let base = booking.subtotal;
  let total = 0;
  for (const rule of applicable) {
    const taxBase = rule.isCompound ? base + total : base;
    const taxAmount = Math.round(taxBase * rule.rate * 100) / 100;
    total += taxAmount;
  }
  return Math.round(total * 100) / 100;
}

function priceWithTax(booking: BookingForTax): number {
  return Math.round((booking.subtotal + totalTaxAmount(booking)) * 100) / 100;
}

function effectiveTaxRate(booking: BookingForTax): number {
  if (booking.subtotal === 0) return 0;
  return Math.round((totalTaxAmount(booking) / booking.subtotal) * 10000) / 100;
}

describe("Tax calculation across jurisdictions", () => {
  it("applicableTaxes: UK venue_hire has 1 rule (VAT)", () => {
    const bk: BookingForTax = { id: "b1", type: "venue_hire", subtotal: 1000, jurisdiction: "UK" };
    expect(applicableTaxes(bk).length).toBe(1);
  });

  it("totalTaxAmount: UK venue_hire $1000 = $200 VAT", () => {
    const bk: BookingForTax = { id: "b1", type: "venue_hire", subtotal: 1000, jurisdiction: "UK" };
    expect(totalTaxAmount(bk)).toBe(200);
  });

  it("priceWithTax: $1000 UK = $1200", () => {
    const bk: BookingForTax = { id: "b1", type: "venue_hire", subtotal: 1000, jurisdiction: "UK" };
    expect(priceWithTax(bk)).toBe(1200);
  });

  it("totalTaxAmount: IN venue_hire = 18% GST + compound 5%", () => {
    const bk: BookingForTax = { id: "b2", type: "venue_hire", subtotal: 1000, jurisdiction: "IN" };
    const tax = totalTaxAmount(bk);
    expect(tax).toBeGreaterThan(180); // more than 18% due to compound
  });

  it("effectiveTaxRate: US_CA venue_hire = 10%", () => {
    const bk: BookingForTax = { id: "b3", type: "venue_hire", subtotal: 1000, jurisdiction: "US_CA" };
    expect(effectiveTaxRate(bk)).toBe(10);
  });

  it("applicableTaxes: unknown jurisdiction → 0 rules", () => {
    const bk: BookingForTax = { id: "b4", type: "venue_hire", subtotal: 1000, jurisdiction: "UNKNOWN" };
    expect(applicableTaxes(bk).length).toBe(0);
  });
});
