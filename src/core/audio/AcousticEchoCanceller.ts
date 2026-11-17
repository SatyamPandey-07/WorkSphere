/**
 * Normalized Least Mean Squares (NLMS) Acoustic Echo Canceller
 * Implements adaptive FIR filtering, Geigel double-talk detection (DTD),
 * non-linear residual echo suppression, and ERLE telemetry.
 */

export const AECMode = {
  DISABLED: 'DISABLED',
  FILTER_ONLY: 'FILTER_ONLY',
  FULL_SUPPRESSION: 'FULL_SUPPRESSION',
} as const;

export type AECMode = (typeof AECMode)[keyof typeof AECMode];

export const DTDState = {
  SILENCE: 'SILENCE',
  FAR_END_ONLY: 'FAR_END_ONLY',
  NEAR_END_ONLY: 'NEAR_END_ONLY',
  DOUBLE_TALK: 'DOUBLE_TALK',
} as const;

export type DTDState = (typeof DTDState)[keyof typeof DTDState];

export interface AECConfig {
  filterLength?: number; // Number of taps (default 256 for ~16-32ms room tail)
  stepSize?: number; // Normalized step-size mu (0.05 to 0.5, default 0.2)
  regularization?: number; // Epsilon to avoid division by zero (default 1e-6)
  dtdThreshold?: number; // Geigel DTD threshold (default 0.5)
  nlpSuppressionFactor?: number; // Residual non-linear suppression (0.0 to 1.0, default 0.85)
  mode?: AECMode;
}

export interface AECTelemetry {
  dtdState: DTDState;
  erleDb: number; // Echo Return Loss Enhancement in dB
  filterEnergy: number;
  micPowerRms: number;
  outputPowerRms: number;
}

export class AcousticEchoCanceller {
  public readonly filterLength: number;
  private stepSize: number;
  private regularization: number;
  private dtdThreshold: number;
  private nlpSuppressionFactor: number;
  private mode: AECMode;

  // Filter weights and delay line buffers
  private weights: Float32Array;
  private refHistory: Float32Array;
  private refHistoryIdx = 0;

  // Telemetry rolling power estimators
  private micPowerAcc = 0;
  private outPowerAcc = 0;
  private currentDtdState: DTDState = DTDState.SILENCE;
  private erleDb = 0;

  constructor(config: AECConfig = {}) {
    this.filterLength = config.filterLength ?? 256;
    this.stepSize = config.stepSize ?? 0.2;
    this.regularization = config.regularization ?? 1e-6;
    this.dtdThreshold = config.dtdThreshold ?? 0.5;
    this.nlpSuppressionFactor = config.nlpSuppressionFactor ?? 0.85;
    this.mode = config.mode ?? AECMode.FULL_SUPPRESSION;

    this.weights = new Float32Array(this.filterLength);
    this.refHistory = new Float32Array(this.filterLength);
  }

  /**
   * Processes a single audio sample.
   * @param micSample Near-end microphone sample d(n) in range [-1.0, 1.0].
   * @param refSample Far-end reference speaker sample x(n) in range [-1.0, 1.0].
   * @returns Cleaned audio sample e(n).
   */
  public processSample(micSample: number, refSample: number): number {
    if (this.mode === AECMode.DISABLED) {
      return micSample;
    }

    const L = this.filterLength;

    // 1. Shift new reference sample into circular history buffer
    this.refHistory[this.refHistoryIdx] = refSample;

    // 2. Compute estimated echo y(n) = w^T * x and reference power ||x||^2
    let estimatedEcho = 0;
    let refPower = 0;
    let maxRefAbs = 0;

    for (let k = 0; k < L; k++) {
      const histIdx = (this.refHistoryIdx - k + L) % L;
      const x = this.refHistory[histIdx];
      estimatedEcho += this.weights[k] * x;
      refPower += x * x;
      const absX = Math.abs(x);
      if (absX > maxRefAbs) maxRefAbs = absX;
    }

    // 3. Compute raw error e(n) = d(n) - y(n)
    const rawError = micSample - estimatedEcho;

    // 4. Double-Talk Detection (Geigel Algorithm)
    const micAbs = Math.abs(micSample);
    const geigelRatio = maxRefAbs > 1e-5 ? micAbs / maxRefAbs : 0;

    let isDoubleTalk = false;
    if (refPower < 1e-5 && micAbs < 1e-4) {
      this.currentDtdState = DTDState.SILENCE;
    } else if (refPower < 1e-5 && micAbs >= 1e-4) {
      this.currentDtdState = DTDState.NEAR_END_ONLY;
      isDoubleTalk = true; // Near-end only speech: freeze adaptation
    } else if (geigelRatio > this.dtdThreshold) {
      this.currentDtdState = DTDState.DOUBLE_TALK;
      isDoubleTalk = true; // Simultaneous double-talk: freeze adaptation
    } else {
      this.currentDtdState = DTDState.FAR_END_ONLY;
    }

    // 5. NLMS Weight Update (Freeze if double-talk detected to prevent divergence)
    if (!isDoubleTalk && refPower > 1e-5) {
      const normFactor = this.stepSize / (this.regularization + refPower);
      for (let k = 0; k < L; k++) {
        const histIdx = (this.refHistoryIdx - k + L) % L;
        const x = this.refHistory[histIdx];
        this.weights[k] += normFactor * rawError * x;
      }
    }

    // Advance circular buffer index
    this.refHistoryIdx = (this.refHistoryIdx + 1) % L;

    // 6. Non-Linear Residual Suppression (NLP)
    let cleanOutput = rawError;
    if (this.mode === AECMode.FULL_SUPPRESSION && this.currentDtdState === DTDState.FAR_END_ONLY) {
      // Near-end is quiet while far-end is echoing -> suppress residual leakage
      cleanOutput *= 1.0 - this.nlpSuppressionFactor;
    }

    // 7. Update Telemetry
    const alpha = 0.99;
    this.micPowerAcc = alpha * this.micPowerAcc + (1 - alpha) * (micSample * micSample);
    this.outPowerAcc = alpha * this.outPowerAcc + (1 - alpha) * (cleanOutput * cleanOutput);

    if (this.micPowerAcc > 1e-6 && this.outPowerAcc > 1e-8) {
      this.erleDb = 10 * Math.log10(this.micPowerAcc / this.outPowerAcc);
    }

    return Math.max(-1.0, Math.min(1.0, cleanOutput));
  }

  /**
   * Processes a fixed block of audio samples (e.g. 128 samples in an AudioWorkletProcessor).
   */
  public processBlock(micBlock: Float32Array, refBlock: Float32Array): Float32Array {
    const len = Math.min(micBlock.length, refBlock.length);
    const output = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      output[i] = this.processSample(micBlock[i], refBlock[i]);
    }

    return output;
  }

  public getTelemetry(): AECTelemetry {
    let filterEnergy = 0;
    for (let i = 0; i < this.weights.length; i++) {
      filterEnergy += this.weights[i] * this.weights[i];
    }

    return {
      dtdState: this.currentDtdState,
      erleDb: Math.round(this.erleDb * 10) / 10,
      filterEnergy,
      micPowerRms: Math.sqrt(this.micPowerAcc),
      outputPowerRms: Math.sqrt(this.outPowerAcc),
    };
  }

  public getWeights(): Float32Array {
    return new Float32Array(this.weights);
  }

  public reset(): void {
    this.weights.fill(0);
    this.refHistory.fill(0);
    this.refHistoryIdx = 0;
    this.micPowerAcc = 0;
    this.outPowerAcc = 0;
    this.currentDtdState = DTDState.SILENCE;
    this.erleDb = 0;
  }
}
