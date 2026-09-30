/**
 * Tests for venue booking invoice reconciliation logic.
 */

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Invoice {
  id: string;
  bookingId: string;
  items: InvoiceItem[];
  discountPercent: number;
  paid: number;
}

function itemTotal(item: InvoiceItem): number {
  return Math.round(item.quantity * item.unitPrice * 100) / 100;
}

function itemTax(item: InvoiceItem): number {
  return Math.round(itemTotal(item) * item.taxRate * 100) / 100;
}

function invoiceSubtotal(invoice: Invoice): number {
  return Math.round(invoice.items.reduce((s, i) => s + itemTotal(i), 0) * 100) / 100;
}

function invoiceDiscount(invoice: Invoice): number {
  return Math.round(invoiceSubtotal(invoice) * (invoice.discountPercent / 100) * 100) / 100;
}

function invoiceTax(invoice: Invoice): number {
  return Math.round(invoice.items.reduce((s, i) => s + itemTax(i), 0) * 100) / 100;
}

function invoiceTotal(invoice: Invoice): number {
  return Math.round((invoiceSubtotal(invoice) - invoiceDiscount(invoice) + invoiceTax(invoice)) * 100) / 100;
}

function balanceDue(invoice: Invoice): number {
  return Math.round((invoiceTotal(invoice) - invoice.paid) * 100) / 100;
}

function reconciliationStatus(invoice: Invoice): "paid" | "partial" | "unpaid" | "overpaid" {
  const due = balanceDue(invoice);
  if (due === 0) return "paid";
  if (due < 0) return "overpaid";
  if (invoice.paid > 0) return "partial";
  return "unpaid";
}

const SAMPLE_INVOICE: Invoice = {
  id: "inv-001", bookingId: "bk-001",
  items: [
    { description: "Venue hire", quantity: 1, unitPrice: 1000, taxRate: 0.1 },
    { description: "Catering",  quantity: 50, unitPrice: 20,   taxRate: 0.08 },
  ],
  discountPercent: 5,
  paid: 1100,
};

describe("Invoice reconciliation", () => {
  it("itemTotal: 50 catering at $20 = $1000", () => {
    expect(itemTotal(SAMPLE_INVOICE.items[1])).toBe(1000);
  });

  it("invoiceSubtotal: $2000", () => {
    expect(invoiceSubtotal(SAMPLE_INVOICE)).toBe(2000);
  });

  it("invoiceDiscount: 5% of $2000 = $100", () => {
    expect(invoiceDiscount(SAMPLE_INVOICE)).toBe(100);
  });

  it("reconciliationStatus: partial when some paid", () => {
    expect(reconciliationStatus(SAMPLE_INVOICE)).toBe("partial");
  });

  it("reconciliationStatus: paid when balance due = 0", () => {
    const fullPaid = { ...SAMPLE_INVOICE, paid: invoiceTotal(SAMPLE_INVOICE) };
    expect(reconciliationStatus(fullPaid)).toBe("paid");
  });

  it("reconciliationStatus: overpaid when paid > total", () => {
    const over = { ...SAMPLE_INVOICE, paid: 9999 };
    expect(reconciliationStatus(over)).toBe("overpaid");
  });
});
