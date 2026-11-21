import { describe, it, expect, beforeEach } from 'vitest';
import {
  GlassBreakDetector,
  DetectorState,
} from '../../core/sensors/GlassBreakDetector';
import type {
  GlassBreakEvent,
  StructuralImpactEvent,
} from '../../core/sensors/GlassBreakDetector';

describe('GlassBreakDetector - DSP Spectral & Coincidence Detector', () => {
  const sampleRate = 44100;
  const fftSize = 1024;
  let detector: GlassBreakDetector;

  beforeEach(() => {
    detector = new GlassBreakDetector({
      sampleRate,
      fftSize,
      impactLowFreqCutoffHz: 250,
      shatterHighFreqLowHz: 3500,
      shatterHighFreqHighHz: 8500,
      impactThresholdEnergy: 0.02,
      shatterThresholdEnergy: 0.02,
      minCoincidenceMs: 15,
      maxCoincidenceMs: 250,
      cooldownPeriodMs: 1000,
    });
  });

  // Helper to generate a sine wave buffer
  function generateTone(frequencyHz: number, amplitude: number = 0.8): Float32Array {
    const buffer = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      buffer[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
    }
    return buffer;
  }

  // Helper to generate multi-tone high-frequency shatter resonance
  function generateShatterAcoustic(amplitude: number = 0.8): Float32Array {
    const buffer = new Float32Array(fftSize);
    const freqs = [4000, 5200, 6800, 7500];
    for (let i = 0; i < fftSize; i++) {
      let sample = 0;
      for (const f of freqs) {
        sample += (amplitude / freqs.length) * Math.sin((2 * Math.PI * f * i) / sampleRate);
      }
      buffer[i] = sample;
    }
    return buffer;
  }

  it('throws an error if fftSize is not a power of 2', () => {
    expect(() => {
      new GlassBreakDetector({ fftSize: 1000 });
    }).toThrow('fftSize must be a power of 2');
  });

  it('correctly calculates spectral energy and centroid for low-frequency impact', () => {
    const thudBuffer = generateTone(120, 0.9);
    const analysis = detector.analyzeSpectrum(thudBuffer);

    expect(analysis.lowFreqEnergy).toBeGreaterThan(0.05);
    expect(analysis.shatterFreqEnergy).toBeLessThan(0.01);
    expect(analysis.peakFrequencyHz).toBeCloseTo(120, -1);
    expect(analysis.spectralCentroidHz).toBeLessThan(500);
  });

  it('correctly calculates spectral energy and centroid for high-frequency shatter', () => {
    const shatterBuffer = generateShatterAcoustic(0.9);
    const analysis = detector.analyzeSpectrum(shatterBuffer);

    expect(analysis.shatterFreqEnergy).toBeGreaterThan(0.05);
    expect(analysis.lowFreqEnergy).toBeLessThan(0.01);
    expect(analysis.shatterRatio).toBeGreaterThan(0.5);
    expect(analysis.spectralCentroidHz).toBeGreaterThan(4000);
  });

  it('detects two-stage glass break sequence within coincidence window', () => {
    let capturedAlert: GlassBreakEvent | undefined;
    detector.onGlassBreak = (event) => {
      capturedAlert = event;
    };

    const t0 = 100000;
    const thud = generateTone(80, 0.9);
    const step1 = detector.processAudioBuffer(thud, t0);
    expect(step1.state).toBe(DetectorState.IMPACT_DETECTED);

    // Provide high-frequency shatter 50ms later (within 15-250ms coincidence window)
    const t1 = t0 + 50;
    const shatter = generateShatterAcoustic(0.9);
    const step2 = detector.processAudioBuffer(shatter, t1);

    expect(step2.state).toBe(DetectorState.COOLDOWN);
    expect(capturedAlert).toBeDefined();
    expect(capturedAlert?.coincidenceDelayMs).toBe(50);
    expect(capturedAlert?.confidence).toBeGreaterThan(0.7);
    expect(capturedAlert?.spectralCentroidHz).toBeGreaterThan(3000);
  });

  it('emits structural impact if shatter does not arrive within maxCoincidenceMs', () => {
    let capturedImpact: StructuralImpactEvent | undefined;
    detector.onStructuralImpact = (event) => {
      capturedImpact = event;
    };

    const t0 = 100000;
    const thud = generateTone(90, 0.9);
    detector.processAudioBuffer(thud, t0);
    expect(detector.getState()).toBe(DetectorState.IMPACT_DETECTED);

    // Advance beyond max coincidence window (300ms > 250ms) with silence
    const t1 = t0 + 300;
    const silence = new Float32Array(fftSize);
    const res = detector.processAudioBuffer(silence, t1);

    expect(res.state).toBe(DetectorState.IDLE);
    expect(capturedImpact).toBeDefined();
    expect(capturedImpact?.impactEnergy).toBeGreaterThan(0.02);
  });

  it('rejects mid-frequency human speech without triggering impact or shatter', () => {
    const speech = generateTone(800, 0.7);
    const res = detector.processAudioBuffer(speech, 1000);

    expect(res.state).toBe(DetectorState.IDLE);
    expect(res.analysis.midFreqEnergy).toBeGreaterThan(0.05);
    expect(res.analysis.shatterRatio).toBeLessThan(0.1);
  });

  it('ignores audio events during cooldown period', () => {
    const t0 = 100000;
    detector.processAudioBuffer(generateTone(80, 0.9), t0);
    detector.processAudioBuffer(generateShatterAcoustic(0.9), t0 + 60);

    expect(detector.getState()).toBe(DetectorState.COOLDOWN);

    // Audio received at t0 + 200 (within 1000ms cooldown) should remain in cooldown
    const res = detector.processAudioBuffer(generateTone(80, 0.9), t0 + 200);
    expect(res.state).toBe(DetectorState.COOLDOWN);

    // Audio received at t0 + 1200 (after cooldown) resets to IDLE
    const resAfter = detector.processAudioBuffer(new Float32Array(fftSize), t0 + 1200);
    expect(resAfter.state).toBe(DetectorState.IDLE);
  });
});
