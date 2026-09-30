/**
 * Tests for payment invoice line item calculations.
 */

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number; // in cents to avoid float issues
}

function lineTotal(item: LineItem): number {
  return item.quantity * item.unitPrice;
}

function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function applyTax(subtotalCents: number, taxRatePct: number): number {
  return Math.round(subtotalCents * (taxRatePct / 100));
}

function applyDiscount(subtotalCents: number, discountPct: number): number {
  return Math.round(subtotalCents * (discountPct / 100));
}

function invoiceTotal(
  items: LineItem[],
  taxRatePct = 0,
  discountPct = 0
): number {
  const sub = subtotal(items);
  const tax = applyTax(sub, taxRatePct);
  const discount = applyDiscount(sub, discountPct);
  return sub + tax - discount;
}

const ITEMS: LineItem[] = [
  { description: "Desk booking", quantity: 2, unitPrice: 1000 }, // 2000
  { description: "Locker",       quantity: 1, unitPrice:  500 }, // 500
];

describe("Invoice line item calculations", () => {
  it("lineTotal for single item", () => {
    expect(lineTotal(ITEMS[0])).toBe(2000);
  });

  it("subtotal sums all line items", () => {
    expect(subtotal(ITEMS)).toBe(2500);
  });

  it("subtotal empty → 0", () => {
    expect(subtotal([])).toBe(0);
  });

  it("applyTax 10% on 2500 → 250", () => {
    expect(applyTax(2500, 10)).toBe(250);
  });

  it("applyTax 0% → 0", () => {
    expect(applyTax(2500, 0)).toBe(0);
  });

  it("applyDiscount 20% on 2500 → 500", () => {
    expect(applyDiscount(2500, 20)).toBe(500);
  });

  it("invoiceTotal no tax no discount", () => {
    expect(invoiceTotal(ITEMS)).toBe(2500);
  });

  it("invoiceTotal with 10% tax", () => {
    expect(invoiceTotal(ITEMS, 10)).toBe(2750);
  });

  it("invoiceTotal with 10% tax and 5% discount", () => {
    // 2500 + 250 tax - 125 discount = 2625
    expect(invoiceTotal(ITEMS, 10, 5)).toBe(2625);
  });
});
