/**
 * Tests for multi-currency price display formatter.
 */

interface CurrencyConfig {
  code: string;
  symbol: string;
  symbolPosition: "before" | "after";
  decimalPlaces: number;
  thousandsSeparator: string;
  decimalSeparator: string;
}

const CURRENCIES: Record<string, CurrencyConfig> = {
  USD: { code: "USD", symbol: "$",  symbolPosition: "before", decimalPlaces: 2, thousandsSeparator: ",", decimalSeparator: "." },
  EUR: { code: "EUR", symbol: "€",  symbolPosition: "before", decimalPlaces: 2, thousandsSeparator: ".", decimalSeparator: "," },
  JPY: { code: "JPY", symbol: "¥",  symbolPosition: "before", decimalPlaces: 0, thousandsSeparator: ",", decimalSeparator: "." },
  GBP: { code: "GBP", symbol: "£",  symbolPosition: "before", decimalPlaces: 2, thousandsSeparator: ",", decimalSeparator: "." },
  SEK: { code: "SEK", symbol: "kr", symbolPosition: "after",  decimalPlaces: 2, thousandsSeparator: " ", decimalSeparator: "," },
};

function formatAmount(amountCents: number, currencyCode: string): string {
  const config = CURRENCIES[currencyCode];
  if (!config) return `${amountCents / 100} ${currencyCode}`;

  const amount = amountCents / (10 ** config.decimalPlaces > 1 ? 10 ** config.decimalPlaces : 100);
  const [intPart, decPart] = amount.toFixed(config.decimalPlaces).split(".");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, config.thousandsSeparator);
  const formatted = config.decimalPlaces > 0 ? `${formattedInt}${config.decimalSeparator}${decPart}` : formattedInt;

  return config.symbolPosition === "before"
    ? `${config.symbol}${formatted}`
    : `${formatted}${config.symbol}`;
}

function parseCurrencyAmount(formatted: string, currencyCode: string): number | null {
  const config = CURRENCIES[currencyCode];
  if (!config) return null;
  const cleaned = formatted.replace(new RegExp(`[${config.thousandsSeparator}${config.symbol} ]`, "g"), "");
  const normalized = cleaned.replace(config.decimalSeparator, ".");
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : Math.round(parsed * 100);
}

describe("Multi-currency price display", () => {
  it("formatAmount: USD 10000 cents = $100.00", () => {
    expect(formatAmount(10000, "USD")).toBe("$100.00");
  });

  it("formatAmount: USD thousands separator", () => {
    expect(formatAmount(1000000, "USD")).toBe("$10,000.00");
  });

  it("formatAmount: JPY no decimals", () => {
    // JPY cents = yen (no sub-units)
    expect(formatAmount(1000, "JPY")).toBe("¥10");
  });

  it("formatAmount: SEK symbol after amount", () => {
    const formatted = formatAmount(5000, "SEK");
    expect(formatted.endsWith("kr")).toBe(true);
  });

  it("parseCurrencyAmount: $100.00 = 10000 cents", () => {
    expect(parseCurrencyAmount("$100.00", "USD")).toBe(10000);
  });

  it("parseCurrencyAmount: unknown currency → null", () => {
    expect(parseCurrencyAmount("100.00", "XYZ")).toBeNull();
  });

  it("round-trip: format then parse", () => {
    const original = 12345;
    const formatted = formatAmount(original, "GBP");
    const parsed = parseCurrencyAmount(formatted, "GBP");
    expect(parsed).toBe(original);
  });
});
