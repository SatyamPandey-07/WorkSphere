import {
  AvionicsSynthesizer,
  type BandpassFilterOptions,
} from '@/lib/audio/AvionicsSynthesizer';

describe('vibe_oscillator SIMD 2nd-order Butterworth Bandpass Filter (#7167)', () => {
  const sampleRate = 48000;
  const quantum = 128; // Standard Web Audio / AudioWorklet render quantum

  describe('Butterworth Filter Coefficient Design', () => {
    it('computes correct 2nd-order Butterworth high-pass coefficients at 80 Hz', () => {
      const coeffs = AvionicsSynthesizer.computeButterworthCoefficients(80, sampleRate, true);

      expect(coeffs.b0).toBeGreaterThan(0);
      expect(coeffs.b1).toBeCloseTo(-2 * coeffs.b0, 5);
      expect(coeffs.b2).toBeCloseTo(coeffs.b0, 5);
      expect(Number.isFinite(coeffs.a1)).toBe(true);
      expect(Number.isFinite(coeffs.a2)).toBe(true);
    });

    it('computes correct 2nd-order Butterworth low-pass coefficients at 8,000 Hz', () => {
      const coeffs = AvionicsSynthesizer.computeButterworthCoefficients(8000, sampleRate, false);

      expect(coeffs.b0).toBeGreaterThan(0);
      expect(coeffs.b1).toBeCloseTo(2 * coeffs.b0, 5);
      expect(coeffs.b2).toBeCloseTo(coeffs.b0, 5);
      expect(Number.isFinite(coeffs.a1)).toBe(true);
      expect(Number.isFinite(coeffs.a2)).toBe(true);
    });
  });

  describe('Frequency Noise Suppression (80 Hz - 8,000 Hz Bandpass)', () => {
    const generateSineWave = (freqHz: number, numSamples: number): Float32Array => {
      const buf = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        buf[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
      }
      return buf;
    };

    const computeRMS = (buf: Float32Array): number => {
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
      }
      return Math.sqrt(sum / buf.length);
    };

    it('suppresses low-frequency air conditioning rumble (40 Hz)', () => {
      const rumbleSamples = generateSineWave(40, 2048);
      const filtered = AvionicsSynthesizer.applyBandpassFilter(rumbleSamples, {
        sampleRate,
        highpassCutoff: 80,
        lowpassCutoff: 8000,
      });

      // Ignore initial filter settling transient (first 256 samples)
      const rawRms = computeRMS(rumbleSamples.subarray(256));
      const filteredRms = computeRMS(filtered.subarray(256));

      const attenuationDb = 20 * Math.log10(rawRms / filteredRms);
      // At 40 Hz (one octave below 80 Hz), 2nd order Butterworth provides ~12 dB attenuation
      expect(attenuationDb).toBeGreaterThan(9.0);
    });

    it('suppresses high-frequency HVAC hiss (14,000 Hz)', () => {
      const hissSamples = generateSineWave(14000, 2048);
      const filtered = AvionicsSynthesizer.applyBandpassFilter(hissSamples, {
        sampleRate,
        highpassCutoff: 80,
        lowpassCutoff: 8000,
      });

      const rawRms = computeRMS(hissSamples.subarray(256));
      const filteredRms = computeRMS(filtered.subarray(256));

      const attenuationDb = 20 * Math.log10(rawRms / filteredRms);
      expect(attenuationDb).toBeGreaterThan(6.0);
    });

    it('passes human voice and ambient speech frequencies (1,000 Hz) without distortion', () => {
      const speechSamples = generateSineWave(1000, 2048);
      const filtered = AvionicsSynthesizer.applyBandpassFilter(speechSamples, {
        sampleRate,
        highpassCutoff: 80,
        lowpassCutoff: 8000,
      });

      const rawRms = computeRMS(speechSamples.subarray(256));
      const filteredRms = computeRMS(filtered.subarray(256));

      const deltaDb = Math.abs(20 * Math.log10(rawRms / filteredRms));
      // Within passband, response should be flat (< 0.5 dB difference)
      expect(deltaDb).toBeLessThan(0.5);
    });
  });

  describe('Microphone Decibel Telemetry Sampling', () => {
    it('calibrates raw vs filtered decibels and flags attenuated noise', () => {
      // Composite signal: 40 Hz rumble (amplitude 0.8) + 1000 Hz speech (amplitude 0.1)
      const composite = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        const rumble = 0.8 * Math.sin((2 * Math.PI * 40 * i) / sampleRate);
        const speech = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
        composite[i] = rumble + speech;
      }

      const result = AvionicsSynthesizer.filterMicrophoneDecibels(composite, { sampleRate });

      expect(result.rawDb).toBeGreaterThan(result.filteredDb);
      expect(result.rumbleAttenuated).toBe(true);
      expect(result.filteredSamples).toHaveLength(512);
    });

    it('handles empty input buffer safely', () => {
      const result = AvionicsSynthesizer.filterMicrophoneDecibels(new Float32Array(0));
      expect(result.rawDb).toBe(-100);
      expect(result.filteredDb).toBe(-100);
      expect(result.filteredSamples).toHaveLength(0);
    });
  });

  describe('Latency SLA Verification (< 0.1ms per 128 samples)', () => {
    it('processes 128 audio samples well under the 0.1ms threshold', () => {
      const buffer128 = new Float32Array(quantum).fill(0.2);
      const bench = AvionicsSynthesizer.benchmarkBandpassLatency(buffer128, 500);

      expect(bench.passedLatencySla).toBe(true);
      expect(bench.latencyPer128SamplesMs).toBeLessThan(0.1);
    });
  });
});
