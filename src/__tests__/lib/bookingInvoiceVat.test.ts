/**
 * Tests for VAT calculation and invoice line item management.
 */

interface VatRate {
  country: string;
  standardRate: number;   // percentage
  reducedRate?: number;
}

const VAT_RATES: Record<string, VatRate> = {
  GB: { country: "United Kingdom", standardRate: 20 },
  DE: { country: "Germany",        standardRate: 19, reducedRate: 7 },
  FR: { country: "France",         standardRate: 20, reducedRate: 5.5 },
  US: { country: "United States",  standardRate: 0 },
};

function getVatRate(countryCode: string, reduced = false): number {
  const rate = VAT_RATES[countryCode];
  if (!rate) return 0;
  if (reduced && rate.reducedRate !== undefined) return rate.reducedRate;
  return rate.standardRate;
}

function calculateVat(netCents: number, vatRatePct: number): number {
  return Math.round(netCents * (vatRatePct / 100));
}

function grossAmount(netCents: number, vatRatePct: number): number {
  return netCents + calculateVat(netCents, vatRatePct);
}

function reverseVat(grossCents: number, vatRatePct: number): { net: number; vat: number } {
  const net = Math.round(grossCents / (1 + vatRatePct / 100));
  return { net, vat: grossCents - net };
}

describe("Booking invoice VAT calculation", () => {
  it("getVatRate: GB = 20%", () => {
    expect(getVatRate("GB")).toBe(20);
  });

  it("getVatRate: DE reduced = 7%", () => {
    expect(getVatRate("DE", true)).toBe(7);
  });

  it("getVatRate: US = 0%", () => {
    expect(getVatRate("US")).toBe(0);
  });

  it("getVatRate: unknown country → 0", () => {
    expect(getVatRate("XX")).toBe(0);
  });

  it("calculateVat: 20% of 10000 = 2000", () => {
    expect(calculateVat(10000, 20)).toBe(2000);
  });

  it("calculateVat: 0% = 0", () => {
    expect(calculateVat(10000, 0)).toBe(0);
  });

  it("grossAmount: 10000 net + 20% = 12000", () => {
    expect(grossAmount(10000, 20)).toBe(12000);
  });

  it("reverseVat: gross 12000 at 20% → net 10000", () => {
    const { net, vat } = reverseVat(12000, 20);
    expect(net).toBe(10000);
    expect(vat).toBe(2000);
  });

  it("reverseVat: net + vat = gross", () => {
    const { net, vat } = reverseVat(11900, 19);
    expect(net + vat).toBe(11900);
  });
});
