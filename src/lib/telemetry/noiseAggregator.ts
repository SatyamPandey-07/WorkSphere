/**
 * Noise Telemetry Outlier Filtering & Exponential Moving Average (EMA) Aggregator (#3472)
 *
 * Implements:
 * 1. Hampel outlier rejection filter using Median Absolute Deviation (MAD)
 *    across sliding windows of incoming decibel samples (default scale factor k = 3).
 * 2. Exponential Moving Average (EMA) with decay weighting factor (α = 0.15)
 *    to smooth transient noise while accurately tracking sustained acoustic shifts.
 * 3. Telemetry quality logging for discarded momentary spikes (e.g. phone drops, mic rustle).
 */

export interface NoiseSample {
  decibel: number;
  timestamp: number;
  sensorId?: string;
}

export interface NoiseFilterResult {
  rawDecibel: number;
  filteredDecibel: number;
  isOutlier: boolean;
  emaDecibel: number;
  median: number;
  mad: number;
  noiseCategory: "quiet" | "moderate" | "loud";
}

export interface NoiseQualityMetric {
  venueId: string;
  rawDecibel: number;
  median: number;
  deviation: number;
  timestamp: number;
  reason: string;
}

/**
 * Calculates the median of an array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculates Median Absolute Deviation (MAD)
 * MAD = median(|x_i - median(X)|)
 */
export function calculateMAD(values: number[], medianVal?: number): number {
  if (values.length === 0) return 0;
  const med = medianVal ?? calculateMedian(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return calculateMedian(deviations);
}

/**
 * Determines acoustic category from decibel value.
 * quiet: < 50 dB
 * moderate: 50 <= dB < 70
 * loud: >= 70 dB
 */
export function getNoiseCategory(decibels: number): "quiet" | "moderate" | "loud" {
  if (decibels < 50) return "quiet";
  if (decibels < 70) return "moderate";
  return "loud";
}

export interface HampelFilterOptions {
  /** Sliding window size (number of past samples) */
  windowSize?: number;
  /** Scale factor multiplier for MAD threshold (default: 3) */
  kScaleFactor?: number;
  /** Exponential decay smoothing factor α (default: 0.15) */
  alpha?: number;
  /** Consistency constant for normally distributed data: 1.4826 */
  normalConsistencyConstant?: number;
}

export class NoiseAggregator {
  private slidingWindow: number[] = [];
  private currentEma: number | null = null;
  public readonly windowSize: number;
  public readonly kScaleFactor: number;
  public readonly alpha: number;
  public readonly normalConsistencyConstant: number;
  private outlierLog: NoiseQualityMetric[] = [];

  constructor(options: HampelFilterOptions = {}) {
    this.windowSize = options.windowSize ?? 10;
    this.kScaleFactor = options.kScaleFactor ?? 3.0;
    this.alpha = options.alpha ?? 0.15;
    this.normalConsistencyConstant = options.normalConsistencyConstant ?? 1.4826;
  }

  /**
   * Processes an incoming raw decibel telemetry reading.
   * - Checks whether sample is an impulse outlier using Hampel Filter.
   * - If outlier: replaces reading with local window median and flags as outlier.
   * - Applies exponential decay (EMA, α=0.15) to update smoothed decibel level.
   */
  processSample(sample: NoiseSample, venueId = "default-venue"): NoiseFilterResult {
    const raw = sample.decibel;

    // Filter out negative, NaN, or non-finite decibel readings from faulty hardware sensors (#5032)
    if (typeof raw !== "number" || isNaN(raw) || !isFinite(raw) || raw < 0) {
      this.outlierLog.push({
        venueId,
        rawDecibel: raw,
        median: this.slidingWindow.length > 0 ? calculateMedian(this.slidingWindow) : 0,
        deviation: 0,
        timestamp: sample.timestamp,
        reason: "Discarded invalid acoustic reading (negative or non-finite decibel value)",
      });

      const currentEmaVal = this.currentEma ?? 0;
      const currentMedianVal = this.slidingWindow.length > 0 ? calculateMedian(this.slidingWindow) : 0;

      return {
        rawDecibel: raw,
        filteredDecibel: currentEmaVal,
        isOutlier: true,
        emaDecibel: Math.round(currentEmaVal * 100) / 100,
        median: Math.round(currentMedianVal * 100) / 100,
        mad: 0,
        noiseCategory: getNoiseCategory(currentEmaVal),
      };
    }

    // If window is empty or small, initialize
    if (this.slidingWindow.length < 3) {
      this.slidingWindow.push(raw);
      if (this.currentEma === null) {
        this.currentEma = raw;
      } else {
        this.currentEma = this.alpha * raw + (1 - this.alpha) * this.currentEma;
      }

      return {
        rawDecibel: raw,
        filteredDecibel: raw,
        isOutlier: false,
        emaDecibel: this.currentEma,
        median: raw,
        mad: 0,
        noiseCategory: getNoiseCategory(this.currentEma),
      };
    }

    const median = calculateMedian(this.slidingWindow);
    const rawMad = calculateMAD(this.slidingWindow, median);
    // Standard error estimated as 1.4826 * MAD
    const nominalScale = rawMad * this.normalConsistencyConstant;
    // Floor threshold to avoid false positives in perfectly static rooms
    const threshold = Math.max(nominalScale * this.kScaleFactor, 6.0);

    const deviation = Math.abs(raw - median);
    const isOutlier = deviation > threshold;

    let effectiveDecibel: number;

    if (isOutlier) {
      // Reject spike: substitute with local median
      effectiveDecibel = median;
      this.outlierLog.push({
        venueId,
        rawDecibel: raw,
        median,
        deviation,
        timestamp: sample.timestamp,
        reason: "Hampel outlier rejection threshold exceeded",
      });
    } else {
      effectiveDecibel = raw;
      // Add valid reading to sliding window
      this.slidingWindow.push(raw);
      if (this.slidingWindow.length > this.windowSize) {
        this.slidingWindow.shift();
      }
    }

    // Apply Exponential Moving Average (EMA)
    if (this.currentEma === null) {
      this.currentEma = effectiveDecibel;
    } else {
      this.currentEma = this.alpha * effectiveDecibel + (1 - this.alpha) * this.currentEma;
    }

    return {
      rawDecibel: raw,
      filteredDecibel: effectiveDecibel,
      isOutlier,
      emaDecibel: Math.round(this.currentEma * 100) / 100,
      median: Math.round(median * 100) / 100,
      mad: Math.round(rawMad * 100) / 100,
      noiseCategory: getNoiseCategory(this.currentEma),
    };
  }

  /**
   * Returns logged noise quality outlier events.
   */
  getOutlierLogs(): NoiseQualityMetric[] {
    return [...this.outlierLog];
  }

  /**
   * Resets the aggregator state.
   */
  reset(): void {
    this.slidingWindow = [];
    this.currentEma = null;
    this.outlierLog = [];
  }
}
