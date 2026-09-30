/**
 * Tests for invoice line item discount application and stacking.
 */

interface InvoiceLineItem {
  itemId: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  discounts: { label: string; amountCents: number }[];
}

function lineSubtotal(item: InvoiceLineItem): number {
  return item.unitPriceCents * item.quantity;
}

function lineDiscountTotal(item: InvoiceLineItem): number {
  return item.discounts.reduce((s, d) => s + d.amountCents, 0);
}

function lineTotal(item: InvoiceLineItem): number {
  return Math.max(0, lineSubtotal(item) - lineDiscountTotal(item));
}

function addDiscount(item: InvoiceLineItem, label: string, amountCents: number): InvoiceLineItem {
  if (amountCents <= 0) throw new Error("Discount must be positive");
  return { ...item, discounts: [...item.discounts, { label, amountCents }] };
}

function invoiceTotal(items: InvoiceLineItem[]): number {
  return items.reduce((s, i) => s + lineTotal(i), 0);
}

function effectiveDiscountPercent(item: InvoiceLineItem): number {
  const subtotal = lineSubtotal(item);
  if (subtotal === 0) return 0;
  return Math.round((lineDiscountTotal(item) / subtotal) * 100);
}

const ITEM: InvoiceLineItem = {
  itemId: "li1",
  description: "Hot Desk × 4h",
  unitPriceCents: 1000,
  quantity: 4,
  discounts: [
    { label: "Member discount",  amountCents: 400 },
    { label: "Early bird 5%",    amountCents: 200 },
  ],
};

describe("Invoice line item discounts", () => {
  it("lineSubtotal: 1000 × 4 = 4000", () => {
    expect(lineSubtotal(ITEM)).toBe(4000);
  });

  it("lineDiscountTotal: 400+200 = 600", () => {
    expect(lineDiscountTotal(ITEM)).toBe(600);
  });

  it("lineTotal: 4000 - 600 = 3400", () => {
    expect(lineTotal(ITEM)).toBe(3400);
  });

  it("lineTotal: clamps to 0 when discounts exceed subtotal", () => {
    const overDiscounted = {
      ...ITEM,
      discounts: [{ label: "Full waiver", amountCents: 5000 }],
    };
    expect(lineTotal(overDiscounted)).toBe(0);
  });

  it("addDiscount: adds new discount", () => {
    const updated = addDiscount(ITEM, "Promo", 100);
    expect(updated.discounts).toHaveLength(3);
    expect(lineDiscountTotal(updated)).toBe(700);
  });

  it("addDiscount: throws for non-positive amount", () => {
    expect(() => addDiscount(ITEM, "Invalid", 0)).toThrow("must be positive");
  });

  it("invoiceTotal: sums all line totals", () => {
    expect(invoiceTotal([ITEM, { ...ITEM, itemId: "li2" }])).toBe(6800);
  });

  it("effectiveDiscountPercent: 600/4000 = 15%", () => {
    expect(effectiveDiscountPercent(ITEM)).toBe(15);
  });
});
