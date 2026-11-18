/**
 * @file PupilDilationTracker.ts
 * @description Task-Evoked Pupillary Response (TEPR) cognitive load tracking,
 * Eye Aspect Ratio (EAR) blink inpainting, Index of Cognitive Activity (ICA), and 20-20-20 eye strain forecasting.
 */

export const CognitiveLoadLevel = {
  LOW_LOAD: 'LOW_LOAD',
  OPTIMAL_FLOW: 'OPTIMAL_FLOW',
  HIGH_LOAD: 'HIGH_LOAD',
  COGNITIVE_FATIGUE: 'COGNITIVE_FATIGUE',
} as const;

export type CognitiveLoadLevelKey = typeof CognitiveLoadLevel[keyof typeof CognitiveLoadLevel];

export const EyeState = {
  OPEN: 'OPEN',
  BLINK: 'BLINK',
  OCCLUDED: 'OCCLUDED',
} as const;

export type EyeStateKey = typeof EyeState[keyof typeof EyeState];

export interface OcularTelemetryFrame {
  timestamp: number;
  leftPupilDiameterMm: number;
  rightPupilDiameterMm: number;
  eyeAspectRatio: number; // EAR
  ambientLux: number; // lux (illuminance)
  gazeFixationDurationMs?: number;
}

export interface PupilAnalysisResult {
  meanPupilDiameterMm: number;
  baselineDiameterMm: number;
  teprDilationMm: number; // Task-evoked pupillary response dilation above ambient baseline
  relativeDilationPct: number;
  indexCognitiveActivity: number; // ICA (0.0 to 1.0)
  cognitiveState: CognitiveLoadLevelKey;
  blinkRatePerMinute: number;
  strainWarning: boolean;
  recommendation: string;
}

export interface TrackerConfig {
  earBlinkThreshold?: number; // default: 0.18
  minValidDiameterMm?: number; // default: 1.5
  maxValidDiameterMm?: number; // default: 9.0
  slidingWindowSize?: number; // default: 60 frames
  continuousFixationLimitMs?: number; // default: 20 * 60 * 1000 (20 min)
}

export class PupilDilationTracker {
  private _earBlinkThreshold: number;
  private _minValidDiameterMm: number;
  private _maxValidDiameterMm: number;
  private _slidingWindowSize: number;
  private _continuousFixationLimitMs: number;
  private _history: OcularTelemetryFrame[];
  private _blinkTimestamps: number[];
  private _lastCleanMeanDiameter: number;

  constructor(config?: TrackerConfig) {
    this._earBlinkThreshold = config?.earBlinkThreshold ?? 0.18;
    this._minValidDiameterMm = config?.minValidDiameterMm ?? 1.5;
    this._maxValidDiameterMm = config?.maxValidDiameterMm ?? 9.0;
    this._slidingWindowSize = config?.slidingWindowSize ?? 60;
    this._continuousFixationLimitMs = config?.continuousFixationLimitMs ?? (20 * 60 * 1000);
    this._history = [];
    this._blinkTimestamps = [];
    this._lastCleanMeanDiameter = 3.5;
  }

  public get frameCount(): number {
    return this._history.length;
  }

  public get blinkCount(): number {
    return this._blinkTimestamps.length;
  }

  /**
   * Evaluates expected pupil diameter given ambient lighting conditions via de Groot & Gebhard empirical model.
   * d_ambient = 4.9 - 3 * tanh(0.4 * (log10(lux + 1) - 0.5))
   */
  public computeAmbientBaselineDiameter(ambientLux: number): number {
    const lux = Math.max(0.1, ambientLux);
    const logLux = Math.log10(lux);
    const dAmbient = 4.9 - 3.0 * Math.tanh(0.4 * (logLux - 0.5));
    return Number(Math.max(2.0, Math.min(8.0, dAmbient)).toFixed(2));
  }

  /**
   * Ingests a new ocular telemetry frame, applies blink detection/inpainting, and computes cognitive metrics.
   */
  public ingestFrame(frame: OcularTelemetryFrame): PupilAnalysisResult {
    const isBlink =
      frame.eyeAspectRatio < this._earBlinkThreshold ||
      frame.leftPupilDiameterMm < this._minValidDiameterMm ||
      frame.rightPupilDiameterMm < this._minValidDiameterMm;

    let cleanMeanDiameter = (frame.leftPupilDiameterMm + frame.rightPupilDiameterMm) / 2.0;

    if (isBlink) {
      // Inpaint with last clean valid diameter to avoid zero/occlusion drops
      cleanMeanDiameter = this._lastCleanMeanDiameter;
      this.recordBlink(frame.timestamp);
    } else {
      // Valid reading: clamp and update baseline
      cleanMeanDiameter = Math.max(
        this._minValidDiameterMm,
        Math.min(this._maxValidDiameterMm, cleanMeanDiameter)
      );
      this._lastCleanMeanDiameter = cleanMeanDiameter;
    }

    const cleanFrame: OcularTelemetryFrame = {
      ...frame,
      leftPupilDiameterMm: cleanMeanDiameter,
      rightPupilDiameterMm: cleanMeanDiameter,
    };

    this._history.push(cleanFrame);
    if (this._history.length > this._slidingWindowSize) {
      this._history.shift();
    }

    return this.analyzeCurrentWindow(cleanFrame, cleanMeanDiameter);
  }

  private analyzeCurrentWindow(currentFrame: OcularTelemetryFrame, currentDiameter: number): PupilAnalysisResult {
    const baselineAmbient = this.computeAmbientBaselineDiameter(currentFrame.ambientLux);
    const teprDilationMm = Number((currentDiameter - baselineAmbient).toFixed(2));
    const relativeDilationPct = Number(((teprDilationMm / baselineAmbient) * 100).toFixed(1));

    // Calculate Index of Cognitive Activity (ICA) based on velocity/jitter of pupil fluctuations
    const ica = this.computeICA();

    // Determine Blink Rate (blinks per minute) over last 60 seconds
    const now = currentFrame.timestamp;
    const recentBlinks = this._blinkTimestamps.filter((t) => now - t <= 60000).length;
    const blinkRatePerMinute = recentBlinks;

    // Classify Cognitive State
    let cognitiveState: CognitiveLoadLevelKey = CognitiveLoadLevel.OPTIMAL_FLOW;
    if (blinkRatePerMinute < 8 && teprDilationMm > 0.4) {
      cognitiveState = CognitiveLoadLevel.COGNITIVE_FATIGUE;
    } else if (ica >= 0.70 || relativeDilationPct > 18.0) {
      cognitiveState = CognitiveLoadLevel.HIGH_LOAD;
    } else if (ica <= 0.25 && relativeDilationPct < 4.0) {
      cognitiveState = CognitiveLoadLevel.LOW_LOAD;
    } else {
      cognitiveState = CognitiveLoadLevel.OPTIMAL_FLOW;
    }

    // 20-20-20 Eye Strain Detection
    const fixationMs = currentFrame.gazeFixationDurationMs ?? 0;
    const strainWarning = fixationMs >= this._continuousFixationLimitMs || blinkRatePerMinute < 10;

    let recommendation = 'Cognitive focus and eye metrics within optimal performance band.';
    if (strainWarning && cognitiveState === CognitiveLoadLevel.COGNITIVE_FATIGUE) {
      recommendation = 'High cognitive fatigue and blink depression detected. Take an immediate 20-20-20 rest break.';
    } else if (strainWarning) {
      recommendation = 'Prolonged screen fixation detected. Look at an object 20 feet away for 20 seconds.';
    } else if (cognitiveState === CognitiveLoadLevel.HIGH_LOAD) {
      recommendation = 'High cognitive load detected. Maintain focus or schedule task decomposition.';
    }

    return {
      meanPupilDiameterMm: Number(currentDiameter.toFixed(2)),
      baselineDiameterMm: baselineAmbient,
      teprDilationMm,
      relativeDilationPct,
      indexCognitiveActivity: ica,
      cognitiveState,
      blinkRatePerMinute,
      strainWarning,
      recommendation,
    };
  }

  /**
   * Computes Index of Cognitive Activity (ICA) by measuring frequency of non-ambient high-velocity micro-dilations.
   */
  private computeICA(): number {
    if (this._history.length < 5) return 0.45; // default neutral flow

    let totalVelocity = 0;
    let inflectionCount = 0;

    for (let i = 1; i < this._history.length; i++) {
      const prev = this._history[i - 1];
      const curr = this._history[i];
      const dt = Math.max(1, curr.timestamp - prev.timestamp) / 1000;
      const dPupil = Math.abs(curr.leftPupilDiameterMm - prev.leftPupilDiameterMm);
      const velocity = dPupil / dt;
      totalVelocity += velocity;

      if (i >= 2) {
        const pprev = this._history[i - 2];
        const v1 = curr.leftPupilDiameterMm - prev.leftPupilDiameterMm;
        const v0 = prev.leftPupilDiameterMm - pprev.leftPupilDiameterMm;
        if ((v1 > 0 && v0 < 0) || (v1 < 0 && v0 > 0)) {
          inflectionCount++;
        }
      }
    }

    const avgVelocity = totalVelocity / (this._history.length - 1);
    const normalizedInflection = inflectionCount / Math.max(1, this._history.length - 2);
    const icaRaw = 0.5 * Math.min(1.0, avgVelocity / 1.5) + 0.5 * normalizedInflection;

    return Number(Math.max(0.05, Math.min(0.98, icaRaw)).toFixed(2));
  }

  private recordBlink(timestamp: number): void {
    // Avoid double counting continuous blink occlusion across consecutive frames within 250ms
    const lastBlink = this._blinkTimestamps[this._blinkTimestamps.length - 1];
    if (!lastBlink || timestamp - lastBlink > 250) {
      this._blinkTimestamps.push(timestamp);
      // Retain last 5 minutes of blink history
      if (this._blinkTimestamps.length > 300) {
        this._blinkTimestamps.shift();
      }
    }
  }
}
