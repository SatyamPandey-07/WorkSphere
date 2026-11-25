import { describe, it, expect, beforeEach } from 'vitest';
import {
  AcousticEchoCanceller,
  AECMode,
  DTDState,
} from '../../core/audio/AcousticEchoCanceller';

describe('AcousticEchoCanceller - Adaptive NLMS Echo Cancellation', () => {
  let aec: AcousticEchoCanceller;

  beforeEach(() => {
    aec = new AcousticEchoCanceller({
      filterLength: 64,
      stepSize: 0.25,
      regularization: 1e-6,
      dtdThreshold: 0.5,
      nlpSuppressionFactor: 0.9,
      mode: AECMode.FULL_SUPPRESSION,
    });
  });

  it('adapts filter weights and cancels room echo (high ERLE)', () => {
    // Simulated room impulse response: tap 8 = 0.5, tap 16 = -0.3
    const roomDelay1 = 8;
    const roomGain1 = 0.5;
    const roomDelay2 = 16;
    const roomGain2 = -0.3;

    const N = 2000;
    const refSignal = new Float32Array(N);
    const micSignal = new Float32Array(N);

    // Far-end signal: white noise
    for (let i = 0; i < N; i++) {
      refSignal[i] = (Math.random() * 2 - 1) * 0.5;
    }

    // Microphone picks up delayed echo
    for (let i = 0; i < N; i++) {
      let echo = 0;
      if (i >= roomDelay1) echo += refSignal[i - roomDelay1] * roomGain1;
      if (i >= roomDelay2) echo += refSignal[i - roomDelay2] * roomGain2;
      micSignal[i] = echo;
    }

    // Process through AEC
    const output = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      output[i] = aec.processSample(micSignal[i], refSignal[i]);
    }

    const telemetry = aec.getTelemetry();
    expect(telemetry.filterEnergy).toBeGreaterThan(0.1);
    expect(telemetry.erleDb).toBeGreaterThan(12.0); // Significant echo attenuation
  });

  it('freezes adaptation when double-talk is detected', () => {
    const N = 200;
    const ref = new Float32Array(N);
    const mic = new Float32Array(N);

    // Both far-end and strong near-end speech active simultaneously
    for (let i = 0; i < N; i++) {
      ref[i] = 0.2 * Math.sin(0.1 * i);
      mic[i] = 0.8 * Math.sin(0.2 * i); // Strong near-end talker
    }

    let detectedDoubleTalk = false;
    for (let i = 0; i < N; i++) {
      aec.processSample(mic[i], ref[i]);
      if (aec.getTelemetry().dtdState === DTDState.DOUBLE_TALK) {
        detectedDoubleTalk = true;
      }
    }

    expect(detectedDoubleTalk).toBe(true);
  });

  it('passes near-end speech cleanly when far-end is silent', () => {
    const N = 500;
    const nearEndSpeech = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      nearEndSpeech[i] = 0.4 * Math.sin(0.05 * i);
    }

    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = aec.processSample(nearEndSpeech[i], 0);
    }

    expect(aec.getTelemetry().dtdState).toBe(DTDState.NEAR_END_ONLY);

    // Output must preserve speech signal without severe attenuation
    let maxDiff = 0;
    for (let i = 50; i < N; i++) {
      const diff = Math.abs(out[i] - nearEndSpeech[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(maxDiff).toBeLessThan(0.01);
  });

  it('processBlock processes 128-sample blocks correctly', () => {
    const blockSize = 128;
    const mic = new Float32Array(blockSize).fill(0.3);
    const ref = new Float32Array(blockSize).fill(0.1);

    const blockOut = aec.processBlock(mic, ref);
    expect(blockOut.length).toBe(blockSize);
  });
});
