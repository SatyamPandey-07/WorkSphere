/**
 * Tests for venue noise decibel level classification.
 */

function classifyDecibelLevel(dB: number): "quiet" | "moderate" | "loud" | "very_loud" {
  if (dB < 45) return "quiet";
  if (dB < 65) return "moderate";
  if (dB < 80) return "loud";
  return "very_loud";
}

function averageDecibels(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10;
}

describe("Venue noise decibel classification", () => {
  it("classifies 30dB as quiet (library-like)", () => {
    expect(classifyDecibelLevel(30)).toBe("quiet");
  });

  it("classifies exactly 44dB as quiet (boundary)", () => {
    expect(classifyDecibelLevel(44)).toBe("quiet");
  });

  it("classifies 45dB as moderate (boundary)", () => {
    expect(classifyDecibelLevel(45)).toBe("moderate");
  });

  it("classifies 60dB as moderate (conversation)", () => {
    expect(classifyDecibelLevel(60)).toBe("moderate");
  });

  it("classifies 65dB as loud", () => {
    expect(classifyDecibelLevel(65)).toBe("loud");
  });

  it("classifies 75dB as loud", () => {
    expect(classifyDecibelLevel(75)).toBe("loud");
  });

  it("classifies 80dB+ as very_loud", () => {
    expect(classifyDecibelLevel(80)).toBe("very_loud");
    expect(classifyDecibelLevel(95)).toBe("very_loud");
  });

  it("averageDecibels returns null for empty samples", () => {
    expect(averageDecibels([])).toBeNull();
  });

  it("averageDecibels calculates correctly", () => {
    expect(averageDecibels([50, 60, 70])).toBe(60);
  });

  it("averageDecibels rounds to 1 decimal", () => {
    expect(averageDecibels([50, 51])).toBe(50.5);
  });
});
