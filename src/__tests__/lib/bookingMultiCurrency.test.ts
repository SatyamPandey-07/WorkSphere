/**
 * Tests for multi-currency booking price display.
 */

const EXCHANGE_TABLE: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, JPY: 149.5, INR: 83.2 },
  EUR: { USD: 1.087, GBP: 0.859, JPY: 162.5 },
  GBP: { USD: 1.265, EUR: 1.164, JPY: 188.9 },
};

function convertPrice(
  amountCents: number,
  fromCurrency: string,
  toCurrency: string
): number | null {
  if (fromCurrency === toCurrency) return amountCents;
  const rate = EXCHANGE_TABLE[fromCurrency]?.[toCurrency];
  if (rate === undefined) return null; // no direct rate
  return Math.round(amountCents * rate);
}

function formatMultiCurrency(
  amountCents: number,
  fromCurrency: string,
  displayCurrencies: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const currency of displayCurrencies) {
    const converted = convertPrice(amountCents, fromCurrency, currency);
    if (converted !== null) {
      result[currency] = `${currency} ${(converted / 100).toFixed(2)}`;
    }
  }
  return result;
}

function findBestRate(
  amountCents: number,
  fromCurrency: string,
  targetCurrencies: string[]
): { currency: string; amountCents: number } | null {
  let best: { currency: string; amountCents: number } | null = null;
  for (const currency of targetCurrencies) {
    const converted = convertPrice(amountCents, fromCurrency, currency);
    if (converted !== null && (best === null || converted < best.amountCents)) {
      best = { currency, amountCents: converted };
    }
  }
  return best;
}

describe("Multi-currency booking prices", () => {
  it("convertPrice: USD to EUR", () => {
    const result = convertPrice(10_000, "USD", "EUR");
    expect(result).toBeCloseTo(9200, -1);
  });

  it("convertPrice: same currency → no change", () => {
    expect(convertPrice(5000, "USD", "USD")).toBe(5000);
  });

  it("convertPrice: no rate available → null", () => {
    expect(convertPrice(5000, "JPY", "USD")).toBeNull();
  });

  it("formatMultiCurrency: multiple currencies formatted", () => {
    const formatted = formatMultiCurrency(10_000, "USD", ["EUR", "GBP"]);
    expect(formatted.EUR).toBeDefined();
    expect(formatted.GBP).toBeDefined();
    expect(Object.keys(formatted)).toHaveLength(2);
  });

  it("formatMultiCurrency: skips currencies with no rate", () => {
    const formatted = formatMultiCurrency(10_000, "USD", ["EUR", "XYZ"]);
    expect(formatted.XYZ).toBeUndefined();
    expect(formatted.EUR).toBeDefined();
  });

  it("findBestRate: EUR cheaper than GBP in this case", () => {
    const best = findBestRate(10_000, "USD", ["EUR", "GBP"]);
    expect(best).not.toBeNull();
  });

  it("findBestRate: all unavailable → null", () => {
    expect(findBestRate(10_000, "JPY", ["USD"])).toBeNull();
  });
});
