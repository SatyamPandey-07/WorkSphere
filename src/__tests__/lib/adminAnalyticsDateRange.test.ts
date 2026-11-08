import { getRangeDays, parseAnalyticsRange, startDateForRange } from "@/lib/adminAnalytics";

describe("getRangeDays", () => {
  it("returns 7 for '7d'", () => {
    expect(getRangeDays("7d")).toBe(7);
  });

  it("returns 30 for '30d'", () => {
    expect(getRangeDays("30d")).toBe(30);
  });

  it("returns 90 for '90d'", () => {
    expect(getRangeDays("90d")).toBe(90);
  });

  it("returns 180 for '180d'", () => {
    expect(getRangeDays("180d")).toBe(180);
  });

  it("returns 365 for '1y'", () => {
    expect(getRangeDays("1y")).toBe(365);
  });

  it("returns a positive number for 'ytd'", () => {
    const days = getRangeDays("ytd");
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(366); // could be a leap year YTD
  });
});

describe("parseAnalyticsRange", () => {
  it("defaults to '30d' for null input", () => {
    expect(parseAnalyticsRange(null)).toBe("30d");
  });

  it("defaults to '30d' for unknown range", () => {
    expect(parseAnalyticsRange("unknown")).toBe("30d");
  });

  it("accepts all 6 valid range keys", () => {
    const validKeys = ["7d", "30d", "90d", "180d", "ytd", "1y"] as const;
    validKeys.forEach((key) => {
      expect(parseAnalyticsRange(key)).toBe(key);
    });
  });
});

describe("startDateForRange", () => {
  it("returns a Date in the past for '7d'", () => {
    const start = startDateForRange("7d");
    expect(start.getTime()).toBeLessThan(Date.now());
  });

  it("'30d' start is earlier than '7d' start", () => {
    const start7 = startDateForRange("7d");
    const start30 = startDateForRange("30d");
    expect(start30.getTime()).toBeLessThan(start7.getTime());
  });

  it("'1y' start is approximately 365 days ago", () => {
    const start = startDateForRange("1y");
    const daysDiff = (Date.now() - start.getTime()) / 86_400_000;
    expect(daysDiff).toBeCloseTo(365, 0);
  });
});
