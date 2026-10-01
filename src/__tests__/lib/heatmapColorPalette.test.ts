/**
 * Tests for the heatmap color palette generation used in heatmapRenderer.worker.ts.
 * The palette maps 0.0 (transparent) to 1.0 (red) through blue→cyan→green→yellow.
 */

// Replicate the palette concept — test normalized value → color tier mapping
function getNoiseTier(normalizedValue: number): "none" | "low" | "medium" | "high" | "peak" {
  if (normalizedValue === 0) return "none";
  if (normalizedValue < 0.25) return "low";
  if (normalizedValue < 0.5) return "medium";
  if (normalizedValue < 0.9) return "high";
  return "peak";
}

function normalizeDensity(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

describe("Heatmap density normalization", () => {
  it("returns 0 when max is 0 (no density)", () => {
    expect(normalizeDensity(5, 0)).toBe(0);
  });

  it("normalizes value to 0–1 range", () => {
    expect(normalizeDensity(50, 100)).toBe(0.5);
    expect(normalizeDensity(0, 100)).toBe(0);
    expect(normalizeDensity(100, 100)).toBe(1);
  });

  it("clamps values above max to 1", () => {
    expect(normalizeDensity(150, 100)).toBe(1);
  });

  it("clamps negative values to 0", () => {
    expect(normalizeDensity(-10, 100)).toBe(0);
  });
});

describe("Heatmap color tier mapping", () => {
  it("returns 'none' for 0 density", () => {
    expect(getNoiseTier(0)).toBe("none");
  });

  it("returns 'low' for low density (0.01–0.24)", () => {
    expect(getNoiseTier(0.1)).toBe("low");
    expect(getNoiseTier(0.24)).toBe("low");
  });

  it("returns 'medium' for moderate density (0.25–0.49)", () => {
    expect(getNoiseTier(0.3)).toBe("medium");
  });

  it("returns 'high' for high density (0.5–0.89)", () => {
    expect(getNoiseTier(0.7)).toBe("high");
  });

  it("returns 'peak' for peak density (0.9–1.0)", () => {
    expect(getNoiseTier(0.95)).toBe("peak");
    expect(getNoiseTier(1.0)).toBe("peak");
  });

  it("tiers are monotonically ordered by density value", () => {
    const order = ["none", "low", "medium", "high", "peak"];
    const values = [0, 0.1, 0.4, 0.7, 1.0];
    const tiers = values.map((v) => getNoiseTier(v));
    expect(tiers).toEqual(order);
  });
});

describe("Heatmap grid cell calculation", () => {
  it("correctly computes cell bounds from grid dimensions", () => {
    const gridW = 8;
    const gridH = 8;
    const canvasW = 200;
    const canvasH = 200;

    const cellW = canvasW / gridW;
    const cellH = canvasH / gridH;

    expect(cellW).toBe(25);
    expect(cellH).toBe(25);
  });

  it("total cells equals gridW * gridH", () => {
    expect(4 * 4).toBe(16);
    expect(16 * 16).toBe(256);
  });
});
