/**
 * AmbientNoiseDosimeter.ts
 * Environmental acoustic noise dosimeter and workspace focus index calculator.
 * Implements IEC 61672-1 A/C frequency weighting, Fast/Slow time exponential integration,
 * OSHA/NIOSH cumulative noise dose tracking, and cognitive focus index assessment.
 */

export type WeightingType = 'A' | 'C' | 'Z'; // Z = unweighted / flat

export type TimeWeighting = 'FAST' | 'SLOW' | 'IMPULSE';

export interface AcousticSample {
  splDba: number;       // A-weighted sound level (dBA)
  splDbc?: number;      // C-weighted sound level (dBC)
  peakDba?: number;     // Instantaneous peak level
  timestamp: number;    // Epoch ms
  durationSec?: number; // Sample window duration in seconds (default 1s)
}

export interface DosimetryStandardConfig {
  criterionLevelDba: number; // e.g. OSHA: 90, NIOSH: 85
  exchangeRateDb: number;    // e.g. OSHA: 5, NIOSH: 3
  thresholdLevelDba: number; // e.g. 80 dBA
  referenceHours: number;    // 8 hours
}

export interface AcousticSummary {
  sampleCount: number;
  totalDurationHours: number;
  leqDba: number;            // Equivalent continuous sound level
  lmaxDba: number;           // Maximum sound level observed
  lminDba: number;           // Minimum sound level observed
  lpeakDba: number;          // Peak instantaneous sound level
  oshaDosePercent: number;   // OSHA daily noise dose % (100% = max allowable)
  oshaTwaDba: number;        // OSHA 8-hour Time-Weighted Average
  nioshDosePercent: number;  // NIOSH daily noise dose %
  nioshTwaDba: number;       // NIOSH 8-hour Time-Weighted Average
  cognitiveFocusScore: number; // 0 to 100 focus suitability index
  acousticTier: 'PRISTINE_FOCUS' | 'MODERATE_OPEN_OFFICE' | 'HIGH_DISTRACTION' | 'HAZARDOUS_NOISE';
}

export class AmbientNoiseDosimeter {
  private readonly samples: AcousticSample[] = [];

  // OSHA 1910.95 Standard Settings
  private readonly oshaConfig: DosimetryStandardConfig = {
    criterionLevelDba: 90.0,
    exchangeRateDb: 5.0,
    thresholdLevelDba: 80.0,
    referenceHours: 8.0,
  };

  // NIOSH REL Standard Settings
  private readonly nioshConfig: DosimetryStandardConfig = {
    criterionLevelDba: 85.0,
    exchangeRateDb: 3.0,
    thresholdLevelDba: 80.0,
    referenceHours: 8.0,
  };

  // Exponential Fast/Slow time-weighting filters
  private fastLeqState: number = 0;
  private slowLeqState: number = 0;

  constructor(initialSamples: AcousticSample[] = []) {
    for (const sample of initialSamples) {
      this.recordSample(sample);
    }
  }

  // --- Sample Ingestion ---

  public recordSample(sample: AcousticSample): void {
    if (sample.splDba < 0 || sample.splDba > 150) {
      throw new Error(`Invalid sound level ${sample.splDba} dBA: must be between 0 and 150 dBA`);
    }

    const durationSec = sample.durationSec ?? 1.0;
    const normalizedSample: AcousticSample = {
      splDba: sample.splDba,
      splDbc: sample.splDbc ?? sample.splDba,
      peakDba: sample.peakDba ?? sample.splDba + 3.0,
      timestamp: sample.timestamp || Date.now(),
      durationSec,
    };

    this.samples.push(normalizedSample);

    // Update exponential smoothing
    const alphaFast = 1.0 - Math.exp(-durationSec / 0.125); // Fast tau = 125ms
    const alphaSlow = 1.0 - Math.exp(-durationSec / 1.0);   // Slow tau = 1000ms

    this.fastLeqState = this.fastLeqState === 0
      ? normalizedSample.splDba
      : alphaFast * normalizedSample.splDba + (1 - alphaFast) * this.fastLeqState;

    this.slowLeqState = this.slowLeqState === 0
      ? normalizedSample.splDba
      : alphaSlow * normalizedSample.splDba + (1 - alphaSlow) * this.slowLeqState;
  }

  // --- Acoustic Formulas & Metrics ---

  /**
   * Computes the equivalent continuous sound level (Leq) using logarithmic energy averaging:
   * Leq = 10 * log10( (1 / T) * sum( Ti * 10^(L_i / 10) ) )
   */
  public computeLeq(): number {
    if (this.samples.length === 0) return 0;

    let totalDuration = 0;
    let energySum = 0;

    for (const s of this.samples) {
      const dur = s.durationSec ?? 1.0;
      totalDuration += dur;
      energySum += dur * Math.pow(10, s.splDba / 10);
    }

    if (totalDuration === 0) return 0;

    const leq = 10 * Math.log10(energySum / totalDuration);
    return Number(leq.toFixed(2));
  }

  /**
   * Computes occupational noise dose percentage for a given standard.
   * Dose% = 100 * sum( C_i / T_i ) where T_i = referenceHours / 2^( (L_i - criterion) / exchangeRate )
   */
  public computeDosePercent(config: DosimetryStandardConfig): number {
    if (this.samples.length === 0) return 0;

    let cumulativeDoseFraction = 0;

    for (const s of this.samples) {
      // Samples below threshold are discarded under occupational standards
      if (s.splDba < config.thresholdLevelDba) continue;

      const durationHours = (s.durationSec ?? 1.0) / 3600;
      // Allowable exposure duration at this sound level
      const allowableHours =
        config.referenceHours /
        Math.pow(2, (s.splDba - config.criterionLevelDba) / config.exchangeRateDb);

      cumulativeDoseFraction += durationHours / (allowableHours || 1e-6);
    }

    return Number((cumulativeDoseFraction * 100).toFixed(3));
  }

  /**
   * Computes 8-Hour Time-Weighted Average (TWA) in dBA.
   * TWA = (exchangeRate / log10(2)) * log10(Dose / 100) + criterion
   */
  public computeTWA(dosePercent: number, config: DosimetryStandardConfig): number {
    if (dosePercent <= 0) return 0;
    const factor = config.exchangeRateDb / Math.log10(2); // ~16.61 for OSHA, ~10 for NIOSH
    const twa = factor * Math.log10(dosePercent / 100) + config.criterionLevelDba;
    return Number(Math.max(0, twa).toFixed(2));
  }

  /**
   * Computes Cognitive Focus Score (0 - 100) based on ambient level and transient disturbance.
   */
  public computeCognitiveFocusScore(): number {
    if (this.samples.length === 0) return 100;

    const leq = this.computeLeq();
    let baseScore = 100;

    // Ideal range for deep focus: 35 dBA - 45 dBA
    if (leq <= 45) {
      baseScore = 100 - Math.max(0, leq - 35) * 1.0;
    } else if (leq <= 65) {
      baseScore = 90 - (leq - 45) * 2.0; // 45 dBA -> 90, 65 dBA -> 50
    } else if (leq <= 80) {
      baseScore = 50 - (leq - 65) * 2.5; // 65 dBA -> 50, 80 dBA -> 12.5
    } else {
      baseScore = Math.max(0, 12.5 - (leq - 80) * 2.0);
    }

    // Transient crest factor penalty: check for loud impulsive spikes
    let maxCrest = 0;
    for (const s of this.samples) {
      const peak = s.peakDba ?? s.splDba;
      const crest = peak - s.splDba;
      if (crest > maxCrest) maxCrest = crest;
    }

    // Impulsive sounds (spikes > 12 dB above background) penalize focus
    const transientPenalty = maxCrest > 12 ? Math.min(25, (maxCrest - 12) * 2) : 0;
    const finalScore = Math.max(0, Math.min(100, baseScore - transientPenalty));

    return Number(finalScore.toFixed(1));
  }

  // --- Complete Acoustic Summary ---

  public getSummary(): AcousticSummary {
    if (this.samples.length === 0) {
      return {
        sampleCount: 0,
        totalDurationHours: 0,
        leqDba: 0,
        lmaxDba: 0,
        lminDba: 0,
        lpeakDba: 0,
        oshaDosePercent: 0,
        oshaTwaDba: 0,
        nioshDosePercent: 0,
        nioshTwaDba: 0,
        cognitiveFocusScore: 100,
        acousticTier: 'PRISTINE_FOCUS',
      };
    }

    const leqDba = this.computeLeq();
    let lmax = -Infinity;
    let lmin = Infinity;
    let lpeak = -Infinity;
    let totalSec = 0;

    for (const s of this.samples) {
      if (s.splDba > lmax) lmax = s.splDba;
      if (s.splDba < lmin) lmin = s.splDba;
      const peak = s.peakDba ?? s.splDba;
      if (peak > lpeak) lpeak = peak;
      totalSec += s.durationSec ?? 1.0;
    }

    const oshaDosePercent = this.computeDosePercent(this.oshaConfig);
    const oshaTwaDba = this.computeTWA(oshaDosePercent, this.oshaConfig);
    const nioshDosePercent = this.computeDosePercent(this.nioshConfig);
    const nioshTwaDba = this.computeTWA(nioshDosePercent, this.nioshConfig);
    const cognitiveFocusScore = this.computeCognitiveFocusScore();

    let acousticTier: AcousticSummary['acousticTier'] = 'PRISTINE_FOCUS';
    if (leqDba > 85 || oshaDosePercent >= 50) {
      acousticTier = 'HAZARDOUS_NOISE';
    } else if (leqDba > 65 || cognitiveFocusScore < 40) {
      acousticTier = 'HIGH_DISTRACTION';
    } else if (leqDba > 48) {
      acousticTier = 'MODERATE_OPEN_OFFICE';
    }

    return {
      sampleCount: this.samples.length,
      totalDurationHours: Number((totalSec / 3600).toFixed(3)),
      leqDba,
      lmaxDba: Number(lmax.toFixed(2)),
      lminDba: Number(lmin.toFixed(2)),
      lpeakDba: Number(lpeak.toFixed(2)),
      oshaDosePercent,
      oshaTwaDba,
      nioshDosePercent,
      nioshTwaDba,
      cognitiveFocusScore,
      acousticTier,
    };
  }

  // --- Static IEC Weighting Approximation Utilities ---

  /**
   * Approximates A-weighting frequency attenuation (in dB) for a given frequency in Hz.
   */
  public static calculateAWeightingDb(freqHz: number): number {
    if (freqHz <= 0) return -100;
    const f2 = freqHz * freqHz;
    const num = Math.pow(12194, 2) * Math.pow(freqHz, 4);
    const den =
      (f2 + Math.pow(20.6, 2)) *
      Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) *
      (f2 + Math.pow(12194, 2));

    const ra = num / den;
    return Number((20 * Math.log10(ra) + 2.0).toFixed(2));
  }

  /**
   * Approximates C-weighting frequency attenuation (in dB) for a given frequency in Hz.
   */
  public static calculateCWeightingDb(freqHz: number): number {
    if (freqHz <= 0) return -100;
    const f2 = freqHz * freqHz;
    const num = Math.pow(12194, 2) * f2;
    const den = (f2 + Math.pow(20.6, 2)) * (f2 + Math.pow(12194, 2));

    const rc = num / den;
    return Number((20 * Math.log10(rc) + 0.06).toFixed(2));
  }
}
