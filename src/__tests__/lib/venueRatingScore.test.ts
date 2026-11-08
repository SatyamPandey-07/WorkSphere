/**
 * Tests for venue WiFi quality rating aggregation.
 */

function averageWifiQuality(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
}

function classifyWifiQuality(avgScore: number | null): "poor" | "fair" | "good" | "excellent" | "unrated" {
  if (avgScore === null) return "unrated";
  if (avgScore < 2) return "poor";
  if (avgScore < 3) return "fair";
  if (avgScore < 4) return "good";
  return "excellent";
}

describe("Venue WiFi quality rating", () => {
  it("returns null for empty ratings", () => {
    expect(averageWifiQuality([])).toBeNull();
  });

  it("single rating equals itself", () => {
    expect(averageWifiQuality([4])).toBe(4);
  });

  it("averages multiple ratings correctly", () => {
    expect(averageWifiQuality([3, 4, 5])).toBe(4);
  });

  it("rounds to 1 decimal place", () => {
    expect(averageWifiQuality([3, 4])).toBe(3.5);
  });

  it("classifies null as unrated", () => {
    expect(classifyWifiQuality(null)).toBe("unrated");
  });

  it("classifies 1.5 as poor", () => {
    expect(classifyWifiQuality(1.5)).toBe("poor");
  });

  it("classifies 2.5 as fair", () => {
    expect(classifyWifiQuality(2.5)).toBe("fair");
  });

  it("classifies 3.5 as good", () => {
    expect(classifyWifiQuality(3.5)).toBe("good");
  });

  it("classifies 4.5 as excellent", () => {
    expect(classifyWifiQuality(4.5)).toBe("excellent");
  });

  it("score 5 is excellent", () => {
    expect(classifyWifiQuality(5)).toBe("excellent");
  });
});
