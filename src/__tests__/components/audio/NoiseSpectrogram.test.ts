import { calculateFrequencyBandEnergy } from "@/components/audio/NoiseSpectrogram";

describe("calculateFrequencyBandEnergy", () => {
  it("aggregates bins into low, mid and high frequency bands", () => {
    const fftSize = 1024;
    const sampleRate = 48_000;
    const bins = new Uint8Array(fftSize / 2);

    // A 46.875 Hz bin spacing places indices 0–5 in low, 6–63 in mid,
    // and the remaining indices in high.
    bins.fill(255, 0, 7);
    bins.fill(128, 7, 64);
    bins.fill(64, 64);

    const result = calculateFrequencyBandEnergy(bins, sampleRate, fftSize);

    expect(result.low).toBe(100);
    expect(result.mid).toBeCloseTo((128 / 255) * 100, 5);
    expect(result.high).toBeCloseTo((64 / 255) * 100, 5);
  });

  it("returns zero energy for empty frequency data", () => {
    expect(
      calculateFrequencyBandEnergy(new Uint8Array(0), 48_000, 1024),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("rejects invalid sampling parameters", () => {
    expect(() =>
      calculateFrequencyBandEnergy(new Uint8Array([10]), 0, 1024),
    ).toThrow("positive finite numbers");
  });
});
