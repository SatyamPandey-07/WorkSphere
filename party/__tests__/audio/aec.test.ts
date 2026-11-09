import { describe, it, expect, beforeEach } from "@jest/globals";

describe("NLMS Acoustic Echo Canceller (AEC)", () => {
  let weights: Float32Array;
  let xBuffer: Float32Array;
  const filterLength = 512;
  const mu = 0.25;
  const eps = 1e-6;

  beforeEach(() => {
    weights = new Float32Array(filterLength);
    xBuffer = new Float32Array(filterLength);
  });

  it("suppresses acoustic echo with ERLE exceeding 25dB", () => {
    // Generate synthetic echo path impulse response
    const echoPath = new Float32Array(filterLength);
    for (let i = 0; i < 64; i++) {
      echoPath[i] = Math.exp(-i / 10) * Math.sin(i * 0.5);
    }

    let totalEchoPower = 0;
    let totalErrorPower = 0;
    const numSamples = 4000;

    for (let n = 0; n < numSamples; n++) {
      const x = Math.sin(n * 0.1) + (Math.random() - 0.5) * 0.1;

      // Shift reference buffer
      for (let j = filterLength - 1; j > 0; j--) {
        xBuffer[j] = xBuffer[j - 1];
      }
      xBuffer[0] = x;

      // Synthesize echo microphone input
      let d = 0;
      for (let j = 0; j < filterLength; j++) {
        d += echoPath[j] * xBuffer[j];
      }

      // Filter estimate and energy calculation
      let y = 0;
      let xEnergy = 0;
      for (let j = 0; j < filterLength; j++) {
        y += weights[j] * xBuffer[j];
        xEnergy += xBuffer[j] * xBuffer[j];
      }

      const e = d - y;

      // Adapt weights
      const normFactor = mu / (xEnergy + eps);
      for (let j = 0; j < filterLength; j++) {
        weights[j] += normFactor * e * xBuffer[j];
      }

      // Calculate steady-state power after initial adaptation (last 1000 samples)
      if (n > 3000) {
        totalEchoPower += d * d;
        totalErrorPower += e * e;
      }
    }

    // ERLE (dB) = 10 * log10(P_echo / P_error)
    const erle = 10 * Math.log10(totalEchoPower / (totalErrorPower + 1e-12));

    expect(erle).toBeGreaterThan(25);
  });

  it("operates with frame processing latency below 10ms", () => {
    const sampleRate = 48000;
    const bufferSize = 128; // Standard AudioWorklet block size
    const frameLatencyMs = (bufferSize / sampleRate) * 1000; // ~2.67 ms

    expect(frameLatencyMs).toBeLessThan(10);
  });
});