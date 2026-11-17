/**
 * Acoustic Glass Break & Structural Impact Detector
 * Implements real-time DSP, Cooley-Tukey Radix-2 FFT, Hann windowing,
 * and dual-stage acoustic event coincidence classification.
 */

export const DetectorState = {
  IDLE: 'IDLE',
  IMPACT_DETECTED: 'IMPACT_DETECTED',
  EVENT_CONFIRMED: 'EVENT_CONFIRMED',
  COOLDOWN: 'COOLDOWN',
} as const;

export type DetectorState = (typeof DetectorState)[keyof typeof DetectorState];

export interface GlassBreakDetectorConfig {
  sampleRate?: number; // e.g. 44100 or 48000
  fftSize?: number; // Power of 2, default 1024
  impactLowFreqCutoffHz?: number; // default 250 Hz
  shatterHighFreqLowHz?: number; // default 3500 Hz
  shatterHighFreqHighHz?: number; // default 8500 Hz
  impactThresholdEnergy?: number; // Minimum low-freq energy for impact trigger
  shatterThresholdEnergy?: number; // Minimum high-freq energy for shatter trigger
  minCoincidenceMs?: number; // Min delay between impact and shatter (default 15ms)
  maxCoincidenceMs?: number; // Max delay between impact and shatter (default 250ms)
  cooldownPeriodMs?: number; // Refractory period after alert (default 1500ms)
  noiseFloorSmoothing?: number; // Leaky integrator coefficient (0.0 to 1.0)
}

export interface SpectralAnalysisResult {
  totalEnergy: number;
  lowFreqEnergy: number;
  midFreqEnergy: number;
  shatterFreqEnergy: number;
  spectralCentroidHz: number;
  shatterRatio: number;
  peakFrequencyHz: number;
  peakMagnitude: number;
}

export interface GlassBreakEvent {
  eventId: string;
  timestamp: number;
  confidence: number; // 0.0 - 1.0
  coincidenceDelayMs: number;
  impactEnergy: number;
  shatterEnergy: number;
  spectralCentroidHz: number;
  peakDb: number;
}

export interface StructuralImpactEvent {
  eventId: string;
  timestamp: number;
  impactEnergy: number;
  peakDb: number;
}

export class GlassBreakDetector {
  public readonly sampleRate: number;
  public readonly fftSize: number;
  private impactLowFreqCutoffHz: number;
  private shatterHighFreqLowHz: number;
  private shatterHighFreqHighHz: number;
  private impactThresholdEnergy: number;
  private shatterThresholdEnergy: number;
  private minCoincidenceMs: number;
  private maxCoincidenceMs: number;
  private cooldownPeriodMs: number;
  private noiseFloorSmoothing: number;

  private state: DetectorState = DetectorState.IDLE;
  private impactTimestamp = 0;
  private impactEnergy = 0;
  private lastAlertTimestamp = 0;
  private estimatedNoiseFloor = 0.01;

  // Precomputed window and FFT tables
  private hannWindow: Float32Array;
  private bitReverseTable: Uint32Array;
  private cosTable: Float32Array;
  private sinTable: Float32Array;

  // Callbacks
  public onGlassBreak?: (event: GlassBreakEvent) => void;
  public onStructuralImpact?: (event: StructuralImpactEvent) => void;

  constructor(config: GlassBreakDetectorConfig = {}) {
    this.sampleRate = config.sampleRate ?? 44100;
    this.fftSize = config.fftSize ?? 1024;
    this.impactLowFreqCutoffHz = config.impactLowFreqCutoffHz ?? 250;
    this.shatterHighFreqLowHz = config.shatterHighFreqLowHz ?? 3500;
    this.shatterHighFreqHighHz = config.shatterHighFreqHighHz ?? 8500;
    this.impactThresholdEnergy = config.impactThresholdEnergy ?? 0.05;
    this.shatterThresholdEnergy = config.shatterThresholdEnergy ?? 0.04;
    this.minCoincidenceMs = config.minCoincidenceMs ?? 15;
    this.maxCoincidenceMs = config.maxCoincidenceMs ?? 250;
    this.cooldownPeriodMs = config.cooldownPeriodMs ?? 1500;
    this.noiseFloorSmoothing = config.noiseFloorSmoothing ?? 0.95;

    // Validate FFT size power of 2
    if ((this.fftSize & (this.fftSize - 1)) !== 0) {
      throw new Error(`fftSize must be a power of 2, received ${this.fftSize}`);
    }

    // Precompute Hann Window
    this.hannWindow = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
    }

    // Precompute Bit-Reversal Table
    this.bitReverseTable = new Uint32Array(this.fftSize);
    const bits = Math.round(Math.log2(this.fftSize));
    for (let i = 0; i < this.fftSize; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitReverseTable[i] = rev;
    }

    // Precompute Twiddle Factors
    this.cosTable = new Float32Array(this.fftSize / 2);
    this.sinTable = new Float32Array(this.fftSize / 2);
    for (let i = 0; i < this.fftSize / 2; i++) {
      const angle = (-2 * Math.PI * i) / this.fftSize;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * Processes a chunk of raw PCM audio samples (e.g. from an AudioWorklet or microphone stream).
   * @param pcmSamples Float32Array of audio samples normalized in range [-1.0, 1.0].
   * @param currentTimeMs Optional monotonic timestamp (defaults to Date.now()).
   */
  public processAudioBuffer(
    pcmSamples: Float32Array | number[],
    currentTimeMs: number = Date.now()
  ): { state: DetectorState; analysis: SpectralAnalysisResult } {
    // Check cooldown state
    if (this.state === DetectorState.COOLDOWN) {
      if (currentTimeMs - this.lastAlertTimestamp > this.cooldownPeriodMs) {
        this.state = DetectorState.IDLE;
      } else {
        const dummy = this.analyzeSpectrum(pcmSamples);
        return { state: this.state, analysis: dummy };
      }
    }

    // Check impact expiration timeout
    if (this.state === DetectorState.IMPACT_DETECTED) {
      const timeSinceImpact = currentTimeMs - this.impactTimestamp;
      if (timeSinceImpact > this.maxCoincidenceMs) {
        // Coincidence timed out without high-freq shatter -> Emit structural impact only
        if (this.onStructuralImpact) {
          this.onStructuralImpact({
            eventId: `impact-${this.impactTimestamp}`,
            timestamp: this.impactTimestamp,
            impactEnergy: this.impactEnergy,
            peakDb: 20 * Math.log10(Math.max(this.impactEnergy, 1e-5)),
          });
        }
        this.state = DetectorState.IDLE;
      }
    }

    const analysis = this.analyzeSpectrum(pcmSamples);

    // Update adaptive ambient noise floor
    this.estimatedNoiseFloor =
      this.noiseFloorSmoothing * this.estimatedNoiseFloor +
      (1 - this.noiseFloorSmoothing) * analysis.totalEnergy;

    const dynamicImpactThresh = Math.max(
      this.impactThresholdEnergy,
      this.estimatedNoiseFloor * 3.0
    );
    const dynamicShatterThresh = Math.max(
      this.shatterThresholdEnergy,
      this.estimatedNoiseFloor * 2.5
    );

    // Stage 1: Detect Initial Low-Frequency Structural Impact
    if (this.state === DetectorState.IDLE) {
      if (
        analysis.lowFreqEnergy > dynamicImpactThresh &&
        analysis.lowFreqEnergy > analysis.shatterFreqEnergy * 1.2
      ) {
        this.state = DetectorState.IMPACT_DETECTED;
        this.impactTimestamp = currentTimeMs;
        this.impactEnergy = analysis.lowFreqEnergy;
      }
    } else if (this.state === DetectorState.IMPACT_DETECTED) {
      // Stage 2: Look for High-Frequency Shatter Resonance within coincidence window
      const deltaMs = currentTimeMs - this.impactTimestamp;
      if (deltaMs >= this.minCoincidenceMs && deltaMs <= this.maxCoincidenceMs) {
        const isShatter =
          analysis.shatterFreqEnergy > dynamicShatterThresh &&
          analysis.shatterRatio > 0.35 &&
          analysis.spectralCentroidHz > 3000;

        if (isShatter) {
          // Glass break confirmed!
          this.state = DetectorState.EVENT_CONFIRMED;
          this.lastAlertTimestamp = currentTimeMs;

          const confidence = Math.min(
            1.0,
            0.4 * Math.min(analysis.shatterRatio / 0.5, 1.0) +
              0.3 * Math.min(analysis.spectralCentroidHz / 6000, 1.0) +
              0.3 * (1.0 - Math.abs(deltaMs - 60) / 200)
          );

          const event: GlassBreakEvent = {
            eventId: `gb-${currentTimeMs}`,
            timestamp: currentTimeMs,
            confidence: Math.round(confidence * 100) / 100,
            coincidenceDelayMs: deltaMs,
            impactEnergy: this.impactEnergy,
            shatterEnergy: analysis.shatterFreqEnergy,
            spectralCentroidHz: Math.round(analysis.spectralCentroidHz),
            peakDb: Math.round(20 * Math.log10(Math.max(analysis.peakMagnitude, 1e-4))),
          };

          if (this.onGlassBreak) {
            this.onGlassBreak(event);
          }

          this.state = DetectorState.COOLDOWN;
        }
      }
    }

    return { state: this.state, analysis };
  }

  /**
   * Performs windowed Fast Fourier Transform and extracts spectral band features.
   */
  public analyzeSpectrum(rawSamples: Float32Array | number[]): SpectralAnalysisResult {
    const N = this.fftSize;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);

    // Apply Hann window and bit-reversal
    const copyLen = Math.min(rawSamples.length, N);
    for (let i = 0; i < copyLen; i++) {
      const rev = this.bitReverseTable[i];
      real[rev] = Number(rawSamples[i]) * this.hannWindow[i];
      imag[rev] = 0;
    }

    // Cooley-Tukey Radix-2 In-Place FFT
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tableIdx = j * step;
          const c = this.cosTable[tableIdx];
          const s = this.sinTable[tableIdx];
          const uR = real[i + j];
          const uI = imag[i + j];
          const vR = real[i + j + halfLen] * c - imag[i + j + halfLen] * s;
          const vI = real[i + j + halfLen] * s + imag[i + j + halfLen] * c;

          real[i + j] = uR + vR;
          imag[i + j] = uI + vI;
          real[i + j + halfLen] = uR - vR;
          imag[i + j + halfLen] = uI - vI;
        }
      }
    }

    // Compute magnitude spectrum and band metrics
    const halfN = N / 2;
    const binWidthHz = this.sampleRate / N;

    let totalEnergy = 0;
    let lowFreqEnergy = 0;
    let midFreqEnergy = 0;
    let shatterFreqEnergy = 0;
    let weightedFreqSum = 0;
    let magnitudeSum = 0;
    let peakMagnitude = 0;
    let peakBin = 0;

    for (let k = 1; k < halfN; k++) {
      const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / halfN;
      const energy = mag * mag;
      const freqHz = k * binWidthHz;

      totalEnergy += energy;
      magnitudeSum += mag;
      weightedFreqSum += freqHz * mag;

      if (mag > peakMagnitude) {
        peakMagnitude = mag;
        peakBin = k;
      }

      if (freqHz <= this.impactLowFreqCutoffHz) {
        lowFreqEnergy += energy;
      } else if (freqHz < this.shatterHighFreqLowHz) {
        midFreqEnergy += energy;
      } else if (freqHz <= this.shatterHighFreqHighHz) {
        shatterFreqEnergy += energy;
      }
    }

    const spectralCentroidHz = magnitudeSum > 1e-6 ? weightedFreqSum / magnitudeSum : 0;
    const shatterRatio = totalEnergy > 1e-6 ? shatterFreqEnergy / totalEnergy : 0;

    return {
      totalEnergy,
      lowFreqEnergy,
      midFreqEnergy,
      shatterFreqEnergy,
      spectralCentroidHz,
      shatterRatio,
      peakFrequencyHz: peakBin * binWidthHz,
      peakMagnitude,
    };
  }

  public getState(): DetectorState {
    return this.state;
  }

  public reset(): void {
    this.state = DetectorState.IDLE;
    this.impactTimestamp = 0;
    this.impactEnergy = 0;
    this.lastAlertTimestamp = 0;
    this.estimatedNoiseFloor = 0.01;
  }
}
