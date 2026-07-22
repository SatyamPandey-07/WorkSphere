import {
  FFT_SIZE,
  averageDbFromFrequencyBins,
  classifyNoise,
  normalizeBinDb,
  peakDbFromFrequencyBins,
  spectrogramColor,
} from "@/lib/noise/fftSpectrogram";

describe("fftSpectrogram helpers", () => {
  it("uses AnalyserNode fftSize 2048", () => {
    expect(FFT_SIZE).toBe(2048);
  });

  it("classifies Quiet / Moderate / Loud by decibel thresholds", () => {
    expect(classifyNoise(30)).toBe("Quiet");
    expect(classifyNoise(44.9)).toBe("Quiet");
    expect(classifyNoise(45)).toBe("Moderate");
    expect(classifyNoise(65)).toBe("Moderate");
    expect(classifyNoise(65.1)).toBe("Loud");
    expect(classifyNoise(90)).toBe("Loud");
  });

  it("computes peak dB from frequency bins", () => {
    const bins = new Float32Array([-80, -40, -60]);
    // (-40 + 100) = 60
    expect(peakDbFromFrequencyBins(bins)).toBe(60);
  });

  it("averages the loudest bins for a live level", () => {
    const bins = new Float32Array([-90, -30, -35, -100]);
    const avg = averageDbFromFrequencyBins(bins, 2);
    // avg of -30 and -35 → -32.5 → 67.5
    expect(avg).toBe(67.5);
  });

  it("normalizes dBFS bins into 0–1", () => {
    expect(normalizeBinDb(-100)).toBe(0);
    expect(normalizeBinDb(-10)).toBe(1);
    expect(normalizeBinDb(-55)).toBeCloseTo(0.5, 2);
  });

  it("returns RGB triples for spectrogram intensity", () => {
    const cold = spectrogramColor(0);
    const hot = spectrogramColor(1);
    expect(cold[2]).toBeGreaterThan(cold[0]);
    expect(hot[0]).toBeGreaterThan(hot[2]);
  });
});
