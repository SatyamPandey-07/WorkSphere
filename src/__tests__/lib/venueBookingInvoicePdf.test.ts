/**
 * Tests for booking invoice PDF data preparation.
 */

interface InvoicePdfData {
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string;
  vendorName: string;
  vendorAddress: string;
  clientName: string;
  clientEmail: string;
  lineItems: { description: string; quantity: number; unitPriceCents: number; totalCents: number }[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  currencyCode: string;
  notes?: string;
  paymentTerms: string;
}

function validateInvoicePdfData(data: Partial<InvoicePdfData>): string[] {
  const errors: string[] = [];
  if (!data.invoiceNumber) errors.push("Invoice number required");
  if (!data.vendorName) errors.push("Vendor name required");
  if (!data.clientName) errors.push("Client name required");
  if (!data.lineItems || data.lineItems.length === 0) errors.push("At least one line item required");
  if (data.totalCents !== undefined && data.totalCents < 0) errors.push("Total cannot be negative");
  if (!data.currencyCode) errors.push("Currency code required");
  return errors;
}

function recalculateTotals(data: InvoicePdfData): InvoicePdfData {
  const subtotal = data.lineItems.reduce((s, i) => s + i.totalCents, 0);
  const total = subtotal + data.taxCents - data.discountCents;
  return {
    ...data,
    subtotalCents: subtotal,
    totalCents: Math.max(0, total),
  };
}

function formatInvoiceDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function generateInvoiceFilename(data: InvoicePdfData): string {
  const dateSuffix = data.issuedDate.replace(/-/g, "");
  return `invoice_${data.invoiceNumber}_${dateSuffix}.pdf`;
}

const INVOICE_DATA: InvoicePdfData = {
  invoiceNumber: "INV-2026-001", issuedDate: "2026-10-01", dueDate: "2026-10-31",
  vendorName: "WorkSphere Inc.", vendorAddress: "123 Main St",
  clientName: "Alice Corp", clientEmail: "billing@alice.com",
  lineItems: [
    { description: "Hot Desk × 4h", quantity: 1, unitPriceCents: 4000, totalCents: 4000 },
    { description: "Coffee Bundle", quantity: 2, unitPriceCents: 350, totalCents: 700 },
  ],
  subtotalCents: 4700, taxCents: 940, discountCents: 200,
  totalCents: 5440, currencyCode: "USD",
  paymentTerms: "Net 30",
};

describe("Booking invoice PDF data", () => {
  it("validateInvoicePdfData: valid data → no errors", () => {
    expect(validateInvoicePdfData(INVOICE_DATA)).toHaveLength(0);
  });

  it("validateInvoicePdfData: missing client → error", () => {
    const missing = { ...INVOICE_DATA, clientName: "" };
    expect(validateInvoicePdfData(missing).some((e) => /client/i.test(e))).toBe(true);
  });

  it("validateInvoicePdfData: empty line items → error", () => {
    const noItems = { ...INVOICE_DATA, lineItems: [] };
    expect(validateInvoicePdfData(noItems).some((e) => /line item/i.test(e))).toBe(true);
  });

  it("recalculateTotals: correct subtotal and total", () => {
    const recalc = recalculateTotals(INVOICE_DATA);
    expect(recalc.subtotalCents).toBe(4700);
    expect(recalc.totalCents).toBe(5440); // 4700+940-200
  });

  it("generateInvoiceFilename: includes invoice number and date", () => {
    const filename = generateInvoiceFilename(INVOICE_DATA);
    expect(filename).toContain("INV-2026-001");
    expect(filename).toContain("20261001");
    expect(filename).toEndWith(".pdf");
  });

  it("formatInvoiceDate: formats date as long form", () => {
    const formatted = formatInvoiceDate("2026-10-01");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("October");
  });
});
