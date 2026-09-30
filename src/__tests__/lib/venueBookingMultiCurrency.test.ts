/**
 * Tests for multi-currency pricing and conversion utilities.
 */

type Currency = "USD" | "EUR" | "GBP" | "INR" | "AUD" | "SGD";

interface ExchangeRate {
  from: Currency;
  to: Currency;
  rate: number;
  updatedAt: number;
}

const RATES: ExchangeRate[] = [
  { from: "USD", to: "EUR", rate: 0.92,  updatedAt: 1_700_000_000_000 },
  { from: "USD", to: "GBP", rate: 0.79,  updatedAt: 1_700_000_000_000 },
  { from: "USD", to: "INR", rate: 83.5,  updatedAt: 1_700_000_000_000 },
  { from: "EUR", to: "USD", rate: 1.087, updatedAt: 1_700_000_000_000 },
];

function getRate(from: Currency, to: Currency): number | null {
  if (from === to) return 1;
  const found = RATES.find((r) => r.from === from && r.to === to);
  return found?.rate ?? null;
}

function convert(amount: number, from: Currency, to: Currency): number | null {
  const rate = getRate(from, to);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}

function formatCurrency(amount: number, currency: Currency): string {
  const symbols: Record<Currency, string> = {
    USD: "$", EUR: "€", GBP: "£", INR: "₹", AUD: "A$", SGD: "S$",
  };
  return `${symbols[currency]}${amount.toFixed(2)}`;
}

function isRateStale(rate: ExchangeRate, nowMs: number, maxAgeMs = 3_600_000): boolean {
  return nowMs - rate.updatedAt > maxAgeMs;
}

function multiCurrencyPrices(
  baseAmountUsd: number,
  currencies: Currency[]
): Record<Currency, number | null> {
  const result: Partial<Record<Currency, number | null>> = {};
  for (const c of currencies) {
    result[c] = convert(baseAmountUsd, "USD", c);
  }
  return result as Record<Currency, number | null>;
}

describe("Multi-currency conversion", () => {
  it("getRate: USD to EUR = 0.92", () => {
    expect(getRate("USD", "EUR")).toBe(0.92);
  });

  it("getRate: same currency = 1", () => {
    expect(getRate("USD", "USD")).toBe(1);
  });

  it("getRate: unknown pair → null", () => {
    expect(getRate("INR", "SGD")).toBeNull();
  });

  it("convert: $100 USD to EUR = $92", () => {
    expect(convert(100, "USD", "EUR")).toBe(92);
  });

  it("convert: $100 USD to INR = $8350", () => {
    expect(convert(100, "USD", "INR")).toBe(8350);
  });

  it("formatCurrency: $9.99 USD", () => {
    expect(formatCurrency(9.99, "USD")).toBe("$9.99");
  });

  it("isRateStale: fresh rate → false", () => {
    expect(isRateStale(RATES[0], 1_700_000_000_000 + 1800_000)).toBe(false);
  });
});
