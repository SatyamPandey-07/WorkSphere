/**
 * Tests for currency conversion and formatting.
 */

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  INR: 83.2,
};

function convertCurrency(
  amountCents: number,
  fromCurrency: string,
  toCurrency: string
): number {
  const fromRate = EXCHANGE_RATES[fromCurrency] ?? 1;
  const toRate = EXCHANGE_RATES[toCurrency] ?? 1;
  return Math.round((amountCents / fromRate) * toRate);
}

function formatAmount(cents: number, currency: string): string {
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹" };
  const symbol = symbols[currency] ?? currency;
  const amount = (cents / 100).toFixed(currency === "JPY" ? 0 : 2);
  return `${symbol}${amount}`;
}

function isValidCurrency(code: string): boolean {
  return code.length === 3 && /^[A-Z]{3}$/.test(code);
}

describe("Currency conversion", () => {
  it("USD to USD: no change", () => {
    expect(convertCurrency(10000, "USD", "USD")).toBe(10000);
  });

  it("USD to EUR: 10000 cents USD = ~9200 cents EUR", () => {
    expect(convertCurrency(10000, "USD", "EUR")).toBe(9200);
  });

  it("EUR to USD round-trip approx", () => {
    const eur = convertCurrency(10000, "USD", "EUR");
    const back = convertCurrency(eur, "EUR", "USD");
    expect(Math.abs(back - 10000)).toBeLessThan(5); // within 5 cents rounding
  });

  it("formatAmount: USD cents", () => {
    expect(formatAmount(2500, "USD")).toBe("$25.00");
  });

  it("formatAmount: EUR with symbol", () => {
    expect(formatAmount(1000, "EUR")).toBe("€10.00");
  });

  it("formatAmount: JPY 0 decimal places", () => {
    expect(formatAmount(100, "JPY")).toBe("¥1");
  });

  it("isValidCurrency: USD → true", () => {
    expect(isValidCurrency("USD")).toBe(true);
  });

  it("isValidCurrency: lowercase → false", () => {
    expect(isValidCurrency("usd")).toBe(false);
  });

  it("isValidCurrency: too short → false", () => {
    expect(isValidCurrency("US")).toBe(false);
  });

  it("isValidCurrency: too long → false", () => {
    expect(isValidCurrency("USDD")).toBe(false);
  });
});
