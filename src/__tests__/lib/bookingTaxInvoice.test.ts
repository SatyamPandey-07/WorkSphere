/**
 * Tests for booking tax invoice generation.
 */

interface TaxInvoiceLine {
  description: string;
  netCents: number;
  taxRatePct: number;
  taxCents: number;
  grossCents: number;
}

interface TaxInvoice {
  invoiceNumber: string;
  bookingId: string;
  userId: string;
  venueId: string;
  lines: TaxInvoiceLine[];
  totalNetCents: number;
  totalTaxCents: number;
  totalGrossCents: number;
  currency: string;
  issuedAt: number;
}

function buildInvoiceLine(
  description: string,
  netCents: number,
  taxRatePct: number
): TaxInvoiceLine {
  const taxCents = Math.round(netCents * (taxRatePct / 100));
  return { description, netCents, taxRatePct, taxCents, grossCents: netCents + taxCents };
}

function buildInvoice(
  invoiceNumber: string,
  bookingId: string,
  userId: string,
  venueId: string,
  lines: TaxInvoiceLine[],
  currency: string,
  nowMs: number
): TaxInvoice {
  return {
    invoiceNumber, bookingId, userId, venueId, lines, currency, issuedAt: nowMs,
    totalNetCents: lines.reduce((s, l) => s + l.netCents, 0),
    totalTaxCents: lines.reduce((s, l) => s + l.taxCents, 0),
    totalGrossCents: lines.reduce((s, l) => s + l.grossCents, 0),
  };
}

function invoiceConsistency(invoice: TaxInvoice): boolean {
  return invoice.totalNetCents + invoice.totalTaxCents === invoice.totalGrossCents;
}

function effectiveTaxRate(invoice: TaxInvoice): number {
  if (invoice.totalNetCents === 0) return 0;
  return Math.round((invoice.totalTaxCents / invoice.totalNetCents) * 100 * 10) / 10;
}

const NOW = 1_700_000_000_000;
const LINES = [
  buildInvoiceLine("Desk Booking - 4h", 4000, 20),
  buildInvoiceLine("Coffee Bundle", 300, 20),
];
const INVOICE = buildInvoice("INV-001", "b1", "u1", "v1", LINES, "GBP", NOW);

describe("Booking tax invoice generation", () => {
  it("buildInvoiceLine: 20% tax on 4000 = 800", () => {
    expect(LINES[0].taxCents).toBe(800);
    expect(LINES[0].grossCents).toBe(4800);
  });

  it("buildInvoice: correct totals", () => {
    expect(INVOICE.totalNetCents).toBe(4300);
    expect(INVOICE.totalTaxCents).toBe(860);
    expect(INVOICE.totalGrossCents).toBe(5160);
  });

  it("invoiceConsistency: net + tax = gross", () => {
    expect(invoiceConsistency(INVOICE)).toBe(true);
  });

  it("effectiveTaxRate: 860/4300 = 20%", () => {
    expect(effectiveTaxRate(INVOICE)).toBe(20);
  });

  it("effectiveTaxRate: zero net → 0", () => {
    const zeroInvoice = { ...INVOICE, totalNetCents: 0, totalTaxCents: 0 };
    expect(effectiveTaxRate(zeroInvoice)).toBe(0);
  });

  it("buildInvoice: issuedAt set correctly", () => {
    expect(INVOICE.issuedAt).toBe(NOW);
  });
});
