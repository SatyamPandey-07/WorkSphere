import {
  processNoiseSuppressionSIMD,
  calculateFrameRMS,
  calculateFrameDecibels,
  DEFAULT_NOISE_THRESHOLD_DB,
} from "@/lib/wasm/audioDSPManager";

describe("WASM SIMD Real-Time Audio Noise Suppression Filter", () => {
  it("calculates RMS and decibels correctly", () => {
    const silentBuffer = new Float32Array(512).fill(0);
    expect(calculateFrameRMS(silentBuffer)).toBe(0);
    expect(calculateFrameDecibels(0)).toBe(-100);

    const signalBuffer = new Float32Array(512).fill(0.1);
    const rms = calculateFrameRMS(signalBuffer);
    expect(rms).toBeCloseTo(0.1);
    const db = calculateFrameDecibels(rms);
    expect(db).toBeGreaterThan(60);
  });

  it("suppresses ambient background noise exceeding 45dB threshold", () => {
    // 512 samples frame (~10.6ms at 48kHz)
    const inputFrame = new Float32Array(512);
    for (let i = 0; i < inputFrame.length; i++) {
      inputFrame[i] = (Math.random() - 0.5) * 0.1; // Ambient noise ~70dB
    }

    const outputFrame = new Float32Array(512);
    const result = processNoiseSuppressionSIMD(inputFrame, outputFrame, {
      thresholdDb: DEFAULT_NOISE_THRESHOLD_DB, // 45dB
      suppressionStrength: 0.8,
    });

    expect(result.decibels).toBeGreaterThan(45);
    expect(result.noiseSuppressed).toBe(true);

    // Verify output frame samples are attenuated
    const inputRms = calculateFrameRMS(inputFrame);
    const outputRms = calculateFrameRMS(outputFrame);
    expect(outputRms).toBeLessThan(inputRms);
  });

  it("does not attenuate signals below 45dB threshold", () => {
    const inputFrame = new Float32Array(512).fill(0.0001); // Very quiet signal (< 45dB)
    const outputFrame = new Float32Array(512);

    const result = processNoiseSuppressionSIMD(inputFrame, outputFrame, {
      thresholdDb: 45,
    });

    expect(result.decibels).toBeLessThan(45);
    expect(result.noiseSuppressed).toBe(false);
    expect(outputFrame[0]).toBe(inputFrame[0]);
  });

  it("maintains under 10ms frame processing latency", () => {
    const inputFrame = new Float32Array(1024);
    for (let i = 0; i < inputFrame.length; i++) {
      inputFrame[i] = Math.sin(i * 0.1);
    }
    const outputFrame = new Float32Array(1024);

    const result = processNoiseSuppressionSIMD(inputFrame, outputFrame, {
      thresholdDb: 45,
    });

    expect(result.latencyMs).toBeLessThan(10);
  });
});
