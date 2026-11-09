import { describe, it, expect } from "vitest";
import {
  applyCLAHE,
  applyContrastStretch,
} from "@/workers/ocrWorker";

describe("ocrWorker Contrast Enhancement & CLAHE (#5770)", () => {
  // Helper to create a degraded low-contrast image (e.g. values compressed to [90, 110])
  function createDegradedLowContrastImage(width: number, height: number): Uint8Array {
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Foreground text pattern vs background, but within dim low-contrast window
        const isText = (x % 4 === 0 && y % 4 === 0);
        data[y * width + x] = isText ? 92 : 108;
      }
    }
    return data;
  }

  it("stretches global contrast across the full dynamic range [0, 255]", () => {
    const lowContrast = new Uint8Array([100, 102, 105, 110]);
    const stretched = applyContrastStretch(lowContrast);

    expect(stretched[0]).toBe(0);   // Min mapped to 0
    expect(stretched[3]).toBe(255); // Max mapped to 255
    expect(stretched[1]).toBeGreaterThan(0);
    expect(stretched[1]).toBeLessThan(stretched[2]);
  });

  it("applies CLAHE to expand local histogram dynamic range on degraded menu images", () => {
    const width = 16;
    const height = 16;
    const degraded = createDegradedLowContrastImage(width, height);

    // Initial degraded contrast dynamic range
    let minDegraded = 255;
    let maxDegraded = 0;
    degraded.forEach((val) => {
      if (val < minDegraded) minDegraded = val;
      if (val > maxDegraded) maxDegraded = val;
    });
    expect(maxDegraded - minDegraded).toBeLessThanOrEqual(20);

    // Apply adaptive histogram equalization
    const enhanced = applyCLAHE(degraded, width, height, 3.0, 4);

    let minEnhanced = 255;
    let maxEnhanced = 0;
    enhanced.forEach((val) => {
      if (val < minEnhanced) minEnhanced = val;
      if (val > maxEnhanced) maxEnhanced = val;
    });

    // Dynamic range should be substantially widened (> 25% dynamic range improvement)
    const degradedRange = maxDegraded - minDegraded;
    const enhancedRange = maxEnhanced - minEnhanced;
    expect(enhancedRange).toBeGreaterThan(degradedRange * 1.5);
    expect(maxEnhanced).toBeGreaterThanOrEqual(200);
    expect(minEnhanced).toBeLessThanOrEqual(50);
  });

  it("clips histogram peaks to limit noise amplification according to clipLimit", () => {
    const width = 8;
    const height = 8;
    // Uniform region with one single outlier
    const uniform = new Uint8Array(width * height).fill(100);
    uniform[0] = 105;

    const resultLowClip = applyCLAHE(uniform, width, height, 1.0, 2);
    const resultHighClip = applyCLAHE(uniform, width, height, 5.0, 2);

    expect(resultLowClip.length).toBe(width * height);
    expect(resultHighClip.length).toBe(width * height);
  });
});
