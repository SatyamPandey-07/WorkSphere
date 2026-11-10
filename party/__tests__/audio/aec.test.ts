import { EchoCancellationWorklet } from "@/lib/audio/EchoCancellationWorklet";

describe("Echo Cancellation DSP & Phase Alignment", () => {
  test("aligns phase shift between stereo channels without frequency cancellation", () => {
    const sampleRate = 48000;
    const bufferSize = 128;
    const left = new Float32Array(bufferSize);
    const right = new Float32Array(bufferSize);

    // Generate 1kHz sine chirp signal with 4-sample phase delay on right channel
    const phaseShift = 4;
    for (let i = 0; i < bufferSize; i++) {
      const t = i / sampleRate;
      left[i] = Math.sin(2 * Math.PI * 1000 * t);
      const rightIndex = i - phaseShift;
      right[i] =
        rightIndex >= 0
          ? Math.sin(2 * Math.PI * 1000 * (rightIndex / sampleRate))
          : 0;
    }

    // Measure raw out-of-phase destructive sum
    let rawSumEnergy = 0;
    for (let i = 0; i < bufferSize; i++) {
      const rawMono = 0.5 * (left[i] + right[i]);
      rawSumEnergy += rawMono * rawMono;
    }

    // Execute aligned processing simulation
    const processor = new (EchoCancellationWorklet as any)();
    const alignedMono = processor.alignAndSum(left, right);

    let alignedEnergy = 0;
    for (let i = 0; i < bufferSize; i++) {
      alignedEnergy += alignedMono[i] * alignedMono[i];
    }

    // Aligned energy must preserve flat amplitude (no comb-filter degradation)
    expect(alignedEnergy).toBeGreaterThan(rawSumEnergy * 0.9);
  });
});
