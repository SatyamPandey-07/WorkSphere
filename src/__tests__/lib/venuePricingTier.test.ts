/**
 * Tests for workspace venue pricing tier classification.
 */

type PricingTier = "free" | "budget" | "standard" | "premium";

function classifyPrice(hourlyRate: number): PricingTier {
  if (hourlyRate <= 0)   return "free";
  if (hourlyRate < 5)    return "budget";
  if (hourlyRate < 15)   return "standard";
  return "premium";
}

function formatPrice(hourlyRate: number, currency = "USD"): string {
  if (hourlyRate <= 0) return "Free";
  return `${currency} ${hourlyRate.toFixed(2)}/hr`;
}

function dailyEstimate(hourlyRate: number, hoursPerDay = 8): number {
  return hourlyRate * hoursPerDay;
}

describe("Venue pricing tier classification", () => {
  it("rate=0 → free", () => {
    expect(classifyPrice(0)).toBe("free");
  });

  it("negative rate → free", () => {
    expect(classifyPrice(-1)).toBe("free");
  });

  it("rate=3 → budget", () => {
    expect(classifyPrice(3)).toBe("budget");
  });

  it("rate=10 → standard", () => {
    expect(classifyPrice(10)).toBe("standard");
  });

  it("rate=20 → premium", () => {
    expect(classifyPrice(20)).toBe("premium");
  });

  it("boundary: rate=5 → standard", () => {
    expect(classifyPrice(5)).toBe("standard");
  });

  it("boundary: rate=14.99 → standard", () => {
    expect(classifyPrice(14.99)).toBe("standard");
  });

  it("formatPrice: zero = 'Free'", () => {
    expect(formatPrice(0)).toBe("Free");
  });

  it("formatPrice: USD 12.50/hr", () => {
    expect(formatPrice(12.5)).toBe("USD 12.50/hr");
  });

  it("formatPrice: custom currency", () => {
    expect(formatPrice(10, "EUR")).toBe("EUR 10.00/hr");
  });

  it("dailyEstimate: 8h default", () => {
    expect(dailyEstimate(10)).toBe(80);
  });

  it("dailyEstimate: custom hours", () => {
    expect(dailyEstimate(5, 6)).toBe(30);
  });
});
