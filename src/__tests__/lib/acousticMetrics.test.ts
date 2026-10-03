import {
  calculateAWeightingGain,
  applyAWeightingToSpectrum,
  designAWeightingBiquads,
  createAWeightingFilter,
  calculateLeq,
  calculateNoisePercentiles,
  classifyAcousticComfort,
  calculateDailyNoiseDose,
  AcousticSessionMonitor,
  BiquadSection,
  CascadedBiquadFilter,
} from "@/lib/acousticMetrics";

describe("IEC 61672-1 Acoustic Metrics Engine", () => {
  describe("calculateAWeightingGain", () => {
    test("returns approximately 0.0 dB at 1000 Hz reference frequency", () => {
      const gain = calculateAWeightingGain(1000);
      expect(gain).toBeCloseTo(0.0, 1);
    });

    test("accurately computes standard IEC 61672-1 attenuation across low frequencies", () => {
      // 20 Hz nominal: ~ -50.5 dB
      const gain20 = calculateAWeightingGain(20);
      expect(gain20).toBeGreaterThanOrEqual(-51.5);
      expect(gain20).toBeLessThanOrEqual(-49.5);

      // 100 Hz nominal: ~ -19.1 dB
      const gain100 = calculateAWeightingGain(100);
      expect(gain100).toBeGreaterThanOrEqual(-19.5);
      expect(gain100).toBeLessThanOrEqual(-18.7);

      // 500 Hz nominal: ~ -3.2 dB
      const gain500 = calculateAWeightingGain(500);
      expect(gain500).toBeGreaterThanOrEqual(-3.5);
      expect(gain500).toBeLessThanOrEqual(-2.9);
    });

    test("accurately computes standard boost and rolloff across high frequencies", () => {
      // 2500 Hz nominal: ~ +1.3 dB
      const gain2500 = calculateAWeightingGain(2500);
      expect(gain2500).toBeGreaterThanOrEqual(1.0);
      expect(gain2500).toBeLessThanOrEqual(1.5);

      // 4000 Hz nominal: ~ +1.0 dB
      const gain4000 = calculateAWeightingGain(4000);
      expect(gain4000).toBeGreaterThanOrEqual(0.8);
      expect(gain4000).toBeLessThanOrEqual(1.3);

      // 10000 Hz nominal: ~ -2.5 dB
      const gain10000 = calculateAWeightingGain(10000);
      expect(gain10000).toBeGreaterThanOrEqual(-2.8);
      expect(gain10000).toBeLessThanOrEqual(-2.2);

      // 20000 Hz nominal: ~ -9.3 dB
      const gain20000 = calculateAWeightingGain(20000);
      expect(gain20000).toBeGreaterThanOrEqual(-9.8);
      expect(gain20000).toBeLessThanOrEqual(-8.8);
    });

    test("returns -Infinity for zero, negative, or non-finite frequencies", () => {
      expect(calculateAWeightingGain(0)).toBe(-Infinity);
      expect(calculateAWeightingGain(-100)).toBe(-Infinity);
      expect(calculateAWeightingGain(NaN)).toBe(-Infinity);
      expect(calculateAWeightingGain(Infinity)).toBe(-Infinity);
    });
  });

  describe("applyAWeightingToSpectrum", () => {
    test("applies dB gain to magnitude spectrum in dB scale", () => {
      const frequencies = [100, 1000, 10000];
      const magnitudes = [50, 50, 50]; // unweighted 50 dB at each bin

      const weighted = applyAWeightingToSpectrum(frequencies, magnitudes, true);

      expect(weighted[0]).toBeCloseTo(50 - 19.14, 1);
      expect(weighted[1]).toBeCloseTo(50, 1);
      expect(weighted[2]).toBeCloseTo(50 - 2.49, 1);
    });

    test("applies linear gain factor to linear magnitude spectrum", () => {
      const frequencies = [1000];
      const magnitudes = [1.0];

      const weighted = applyAWeightingToSpectrum(frequencies, magnitudes, false);
      expect(weighted[0]).toBeCloseTo(1.0, 2);
    });

    test("handles mismatched array lengths safely without crashing", () => {
      const frequencies = [100, 1000];
      const magnitudes = [40];

      const weighted = applyAWeightingToSpectrum(frequencies, magnitudes);
      expect(weighted).toHaveLength(1);
    });

    test("handles zero frequency in spectrum gracefully", () => {
      const weighted = applyAWeightingToSpectrum([0], [60], true);
      expect(weighted[0]).toBe(-Infinity);

      const weightedLinear = applyAWeightingToSpectrum([0], [1.0], false);
      expect(weightedLinear[0]).toBe(0);
    });
  });

  describe("Digital Biquad Filter Design and Cascade", () => {
    test("designAWeightingBiquads produces 3 second-order sections", () => {
      const biquads = designAWeightingBiquads(48000);
      expect(biquads).toHaveLength(3);
      for (const b of biquads) {
        expect(Number.isFinite(b.b0)).toBe(true);
        expect(Number.isFinite(b.b1)).toBe(true);
        expect(Number.isFinite(b.b2)).toBe(true);
        expect(Number.isFinite(b.a1)).toBe(true);
        expect(Number.isFinite(b.a2)).toBe(true);
      }
    });

    test("throws an error when non-positive sample rate is provided", () => {
      expect(() => designAWeightingBiquads(0)).toThrow("Sample rate must be positive.");
      expect(() => designAWeightingBiquads(-44100)).toThrow("Sample rate must be positive.");
    });

    test("BiquadSection processes samples and resets delay states", () => {
      const section = new BiquadSection({
        b0: 1,
        b1: 0,
        b2: 0,
        a1: 0,
        a2: 0,
      });

      const out = section.process(0.5);
      expect(out).toBe(0.5);

      expect(() => section.reset()).not.toThrow();
    });

    test("createAWeightingFilter produces normalized cascaded filter", () => {
      const filter = createAWeightingFilter(48000);
      expect(filter).toBeInstanceOf(CascadedBiquadFilter);

      // Process 1000 Hz sine wave and verify output amplitude after settling
      const sampleRate = 48000;
      const freq = 1000;
      const numSamples = 2400; // 50 ms
      const input = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        input[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const output = filter.processBuffer(input);
      expect(output).toHaveLength(numSamples);

      // Check steady-state amplitude (last 200 samples)
      let peak = 0;
      for (let i = numSamples - 200; i < numSamples; i++) {
        peak = Math.max(peak, Math.abs(output[i]));
      }
      expect(peak).toBeGreaterThan(0.9);
      expect(peak).toBeLessThan(1.1);
    });

    test("filter resets internal states across calls", () => {
      const filter = createAWeightingFilter(48000);
      filter.processSample(1.0);
      filter.reset();
      const firstZeroResponse = filter.processSample(0.0);
      expect(firstZeroResponse).toBe(0.0);
    });
  });

  describe("calculateLeq (Equivalent Continuous Sound Level)", () => {
    test("calculates logarithmic energy integration instead of arithmetic average", () => {
      // 50 dB, 60 dB, 70 dB
      // Arithmetic average is 60 dB
      // True energy-equivalent Leq = 10 * log10( (10^5 + 10^6 + 10^7) / 3 ) ≈ 65.7 dB
      const frames = [50, 60, 70];
      const leq = calculateLeq(frames);

      expect(leq).toBe(65.7);
      expect(leq).toBeGreaterThan(60); // Demonstrates mathematical energy dominance
    });

    test("returns same level when all input frames are identical", () => {
      const frames = [55, 55, 55, 55];
      expect(calculateLeq(frames)).toBe(55.0);
    });

    test("returns noise floor when frame array is empty or contains non-finite values", () => {
      expect(calculateLeq([])).toBe(30.0);
      expect(calculateLeq([NaN, Infinity, -Infinity])).toBe(30.0);
      expect(calculateLeq([], { noiseFloor: 25 })).toBe(25.0);
    });

    test("filters out invalid values and averages remaining valid frames", () => {
      const frames = [50, NaN, 50, -Infinity];
      expect(calculateLeq(frames)).toBe(50.0);
    });

    test("respects decimal rounding options", () => {
      const frames = [50, 60, 70];
      expect(calculateLeq(frames, { roundDecimals: 3 })).toBe(65.682);
    });
  });

  describe("calculateNoisePercentiles", () => {
    test("calculates standard statistical percentiles L10, L50, L90, Lmin, Lmax", () => {
      // 10 sorted frames: 40, 42, 45, 47, 50, 52, 55, 60, 70, 85
      const frames = [40, 42, 45, 47, 50, 52, 55, 60, 70, 85];
      const percentiles = calculateNoisePercentiles(frames);

      expect(percentiles.lMax).toBe(85.0);
      expect(percentiles.lMin).toBe(40.0);
      expect(percentiles.l10).toBeGreaterThanOrEqual(70.0);
      expect(percentiles.l50).toBeCloseTo(51.0, 0);
      expect(percentiles.l90).toBeLessThanOrEqual(43.0);

      // Invariant check: L10 >= L50 >= L90
      expect(percentiles.l10).toBeGreaterThanOrEqual(percentiles.l50);
      expect(percentiles.l50).toBeGreaterThanOrEqual(percentiles.l90);

      // Intrusiveness is L10 - L90
      expect(percentiles.intrusiveness).toBe(
        Math.round((percentiles.l10 - percentiles.l90) * 10) / 10,
      );
    });

    test("returns 0 intrusiveness for constant sound levels", () => {
      const frames = [60, 60, 60, 60, 60];
      const percentiles = calculateNoisePercentiles(frames);

      expect(percentiles.l10).toBe(60.0);
      expect(percentiles.l50).toBe(60.0);
      expect(percentiles.l90).toBe(60.0);
      expect(percentiles.intrusiveness).toBe(0.0);
    });

    test("handles empty or invalid arrays safely", () => {
      const percentiles = calculateNoisePercentiles([]);
      expect(percentiles.l10).toBe(30.0);
      expect(percentiles.l50).toBe(30.0);
      expect(percentiles.l90).toBe(30.0);
      expect(percentiles.intrusiveness).toBe(0.0);
    });

    test("handles single sample correctly", () => {
      const percentiles = calculateNoisePercentiles([65]);
      expect(percentiles.l10).toBe(65.0);
      expect(percentiles.l50).toBe(65.0);
      expect(percentiles.l90).toBe(65.0);
      expect(percentiles.lMin).toBe(65.0);
      expect(percentiles.lMax).toBe(65.0);
      expect(percentiles.intrusiveness).toBe(0.0);
    });
  });

  describe("classifyAcousticComfort", () => {
    test("classifies quiet environments (< 50 dBA) as deep_focus", () => {
      const profile = classifyAcousticComfort(45.2);
      expect(profile.category).toBe("deep_focus");
      expect(profile.focusSuitability).toBe("ideal");
      expect(profile.recommendedSessionMinutes).toBeNull();
    });

    test("classifies moderate environments (50 - 64.9 dBA) as conversational", () => {
      const profile = classifyAcousticComfort(58.0);
      expect(profile.category).toBe("conversational");
      expect(profile.focusSuitability).toBe("acceptable");
      expect(profile.recommendedSessionMinutes).toBe(480);
    });

    test("classifies lively environments (65 - 74.9 dBA) as lively", () => {
      const profile = classifyAcousticComfort(69.5);
      expect(profile.category).toBe("lively");
      expect(profile.focusSuitability).toBe("limited");
      expect(profile.recommendedSessionMinutes).toBe(180);
    });

    test("classifies loud environments (>= 75 dBA) as hazardous_loud", () => {
      const profile = classifyAcousticComfort(82.3);
      expect(profile.category).toBe("hazardous_loud");
      expect(profile.focusSuitability).toBe("unsuitable");
      expect(profile.recommendedSessionMinutes).toBe(45);
    });

    test("handles threshold boundaries correctly", () => {
      expect(classifyAcousticComfort(49.9).category).toBe("deep_focus");
      expect(classifyAcousticComfort(50.0).category).toBe("conversational");
      expect(classifyAcousticComfort(64.9).category).toBe("conversational");
      expect(classifyAcousticComfort(65.0).category).toBe("lively");
      expect(classifyAcousticComfort(74.9).category).toBe("lively");
      expect(classifyAcousticComfort(75.0).category).toBe("hazardous_loud");
    });
  });

  describe("calculateDailyNoiseDose", () => {
    test("calculates exactly 100% NIOSH dose for 85 dBA across 8 hours", () => {
      const result = calculateDailyNoiseDose(85, 480, "NIOSH");
      expect(result.dosePercentage).toBe(100.0);
      expect(result.isExceeded).toBe(true);
      expect(result.timeWeightedAverage).toBe(85.0);
      expect(result.allowableHours).toBe(8.0);
      expect(result.exposureHours).toBe(8.0);
    });

    test("evaluates NIOSH 3 dB exchange rate (88 dBA allowable for 4 hours)", () => {
      const result = calculateDailyNoiseDose(88, 240, "NIOSH");
      expect(result.allowableHours).toBe(4.0);
      expect(result.dosePercentage).toBe(100.0);
      expect(result.isExceeded).toBe(true);
    });

    test("evaluates safe low dose under quiet working conditions", () => {
      // 55 dBA for 8 hours in library
      const result = calculateDailyNoiseDose(55, 480, "NIOSH");
      expect(result.dosePercentage).toBeLessThan(0.2);
      expect(result.isExceeded).toBe(false);
    });

    test("calculates OSHA standard (90 dBA criterion, 5 dB exchange rate)", () => {
      const result90 = calculateDailyNoiseDose(90, 480, "OSHA");
      expect(result90.allowableHours).toBe(8.0);
      expect(result90.dosePercentage).toBe(100.0);

      const result95 = calculateDailyNoiseDose(95, 240, "OSHA");
      expect(result95.allowableHours).toBe(4.0);
      expect(result95.dosePercentage).toBe(100.0);
    });

    test("handles zero duration exposure safely", () => {
      const result = calculateDailyNoiseDose(85, 0, "NIOSH");
      expect(result.dosePercentage).toBe(0.0);
      expect(result.exposureHours).toBe(0.0);
      expect(result.isExceeded).toBe(false);
    });
  });

  describe("AcousticSessionMonitor", () => {
    test("accumulates streaming frames and computes metrics", () => {
      const monitor = new AcousticSessionMonitor();
      monitor.addFrames([45, 48, 52, 47, 46]);

      expect(monitor.getFrameCount()).toBe(5);
      expect(monitor.getCurrentLeq()).toBeGreaterThan(45);
      expect(monitor.getComfortProfile().category).toBe("deep_focus");
    });

    test("enforces sliding maxWindowSize by evicting oldest frames", () => {
      const monitor = new AcousticSessionMonitor({ maxWindowSize: 3 });
      monitor.addFrames([40, 50, 60]);
      expect(monitor.getFrames()).toEqual([40, 50, 60]);

      monitor.addFrame(70);
      expect(monitor.getFrames()).toEqual([50, 60, 70]);
      expect(monitor.getFrameCount()).toBe(3);
    });

    test("getSummary provides comprehensive acoustic report", () => {
      const monitor = new AcousticSessionMonitor();
      monitor.addFrames([55, 58, 62, 59, 56]);

      const summary = monitor.getSummary(60); // 60 minutes
      expect(summary.frameCount).toBe(5);
      expect(summary.durationSeconds).toBe(3600);
      expect(summary.leq).toBeGreaterThan(55);
      expect(summary.percentiles.l10).toBeGreaterThanOrEqual(summary.percentiles.l50);
      expect(summary.comfortProfile.category).toBe("conversational");
      expect(summary.noiseDose.dosePercentage).toBeGreaterThan(0);
    });

    test("clears recorded frames upon reset", () => {
      const monitor = new AcousticSessionMonitor();
      monitor.addFrames([50, 55, 60]);
      expect(monitor.getFrameCount()).toBe(3);

      monitor.clear();
      expect(monitor.getFrameCount()).toBe(0);
      expect(monitor.getCurrentLeq()).toBe(30.0);
    });
  });
});
