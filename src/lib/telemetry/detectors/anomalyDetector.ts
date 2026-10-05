/**
 * Resilient Statistical Telemetry Anomaly Detector for Venue Telemetry.
 * Uses Modified Z-score (Median & MAD), Exponential Moving Average (EMA) with
 * dynamic volatility bands, rate-of-change (gradient) analysis, and physical bounds checks.
 */

import type {
  TelemetryMetricType,
  TelemetryPoint,
  AnomalyDetectionConfig,
  AnomalyResult,
  BaselineStats,
} from "../types";

export const DEFAULT_CONFIGS: Record<TelemetryMetricType, AnomalyDetectionConfig> = {
  noise_db: {
    windowSize: 30,
    minSamplesForDetection: 5,
    modifiedZScoreThreshold: 3.5,
    emaAlpha: 0.2,
    volatilityBandMultiplier: 2.5,
    maxRateOfChangePerSec: 25,
    physicalBounds: { min: 10, max: 135 },
  },
  occupancy_percent: {
    windowSize: 20,
    minSamplesForDetection: 5,
    modifiedZScoreThreshold: 3.5,
    emaAlpha: 0.15,
    volatilityBandMultiplier: 2.5,
    maxRateOfChangePerSec: 30,
    physicalBounds: { min: 0, max: 100 },
  },
  wifi_latency_ms: {
    windowSize: 30,
    minSamplesForDetection: 5,
    modifiedZScoreThreshold: 3.5,
    emaAlpha: 0.2,
    volatilityBandMultiplier: 3.0,
    physicalBounds: { min: 0, max: 15000 },
  },
  generic: {
    windowSize: 30,
    minSamplesForDetection: 5,
    modifiedZScoreThreshold: 3.5,
    emaAlpha: 0.2,
    volatilityBandMultiplier: 2.5,
  },
};

/**
 * Calculates median of an array of numeric values.
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
 * Calculates Median Absolute Deviation (MAD).
 * MAD = median(|x_i - median(X)|)
 */
export function calculateMAD(values: number[], medianVal?: number): number {
  if (values.length <= 1) return 0;
  const med = medianVal !== undefined ? medianVal : calculateMedian(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return calculateMedian(deviations);
}

/**
 * Calculates standard Boris Iglewicz and David Hoaglin (1993) Modified Z-score.
 * M_i = 0.6745 * |x_i - median| / MAD
 */
export function calculateModifiedZScore(
  value: number,
  median: number,
  mad: number,
): number {
  if (mad === 0) {
    return value === median ? 0 : Infinity;
  }
  return (0.6745 * Math.abs(value - median)) / mad;
}

/**
 * Calculates standard deviation.
 */
export function calculateStandardDeviation(values: number[], meanVal?: number): number {
  if (values.length <= 1) return 0;
  const mean = meanVal !== undefined ? meanVal : values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export class TelemetryAnomalyDetector {
  private config: AnomalyDetectionConfig;
  private window: TelemetryPoint[] = [];
  private ema: number | null = null;

  constructor(
    public readonly metricType: TelemetryMetricType = "generic",
    config: Partial<AnomalyDetectionConfig> = {},
  ) {
    const baseConfig = DEFAULT_CONFIGS[metricType] || DEFAULT_CONFIGS.generic;
    this.config = { ...baseConfig, ...config };
  }

  /**
   * Evaluates and records a new telemetry point into the sliding window.
   */
  public record(value: number, timestamp = Date.now()): AnomalyResult {
    const result = this.evaluate(value, timestamp);

    if (result.severity !== "sensor_fault") {
      this.window.push({ value, timestamp });

      if (this.ema === null) {
        this.ema = value;
      } else {
        this.ema = this.config.emaAlpha * value + (1 - this.config.emaAlpha) * this.ema;
      }

      if (this.window.length > this.config.windowSize) {
        this.window.shift();
      }
    }

    return result;
  }

  /**
   * Inspects a candidate value against current baseline without mutating state.
   */
  public inspect(value: number, timestamp = Date.now()): AnomalyResult {
    return this.evaluate(value, timestamp);
  }

  private evaluate(value: number, timestamp: number): AnomalyResult {
    // 1. Check physical bounds
    if (this.config.physicalBounds) {
      const { min, max } = this.config.physicalBounds;
      if (
        (min !== undefined && value < min) ||
        (max !== undefined && value > max) ||
        Number.isNaN(value) ||
        !Number.isFinite(value)
      ) {
        return {
          isAnomaly: true,
          severity: "sensor_fault",
          value,
          timestamp,
          zScore: null,
          ema: this.ema,
          baselineMedian: null,
          mad: null,
          rateOfChange: null,
          reason: `Value ${value} is outside physical realistic bounds [${min ?? "-∞"}, ${max ?? "+∞"}]`,
        };
      }
    }

    // 2. Check rate of change (gradient) if previous point exists
    let rateOfChange: number | null = null;
    if (this.window.length > 0 && this.config.maxRateOfChangePerSec) {
      const lastPoint = this.window[this.window.length - 1];
      const deltaSec = (timestamp - lastPoint.timestamp) / 1000;

      if (deltaSec >= 0.1) {
        rateOfChange = Math.abs(value - lastPoint.value) / deltaSec;

        if (rateOfChange > this.config.maxRateOfChangePerSec) {
          return {
            isAnomaly: true,
            severity: "critical_surge",
            value,
            timestamp,
            zScore: null,
            ema: this.ema,
            baselineMedian: null,
            mad: null,
            rateOfChange: Math.round(rateOfChange * 10) / 10,
            reason: `Excessive rate of change: ${Math.round(rateOfChange)} units/sec exceeds threshold ${this.config.maxRateOfChangePerSec} units/sec`,
          };
        }
      }
    }

    // 3. Not enough samples for statistical outlier detection
    if (this.window.length < this.config.minSamplesForDetection) {
      return {
        isAnomaly: false,
        severity: "normal",
        value,
        timestamp,
        zScore: null,
        ema: this.ema,
        baselineMedian: null,
        mad: null,
        rateOfChange,
      };
    }

    // 4. Calculate Modified Z-score using Median & MAD
    const values = this.window.map((p) => p.value);
    const median = calculateMedian(values);
    const mad = calculateMAD(values, median);
    const zScore = calculateModifiedZScore(value, median, mad);

    // 5. Compare against EMA & volatility bands
    const stdDev = calculateStandardDeviation(values);
    const isEmaBreached =
      this.ema !== null &&
      stdDev > 0 &&
      Math.abs(value - this.ema) > this.config.volatilityBandMultiplier * stdDev;

    // Severity determination
    if (zScore >= this.config.modifiedZScoreThreshold * 1.8 || (zScore >= this.config.modifiedZScoreThreshold && isEmaBreached)) {
      return {
        isAnomaly: true,
        severity: "critical_surge",
        value,
        timestamp,
        zScore: Math.round(zScore * 100) / 100,
        ema: this.ema !== null ? Math.round(this.ema * 10) / 10 : null,
        baselineMedian: Math.round(median * 10) / 10,
        mad: Math.round(mad * 100) / 100,
        rateOfChange,
        reason: `Critical surge detected: Modified Z-score (${zScore.toFixed(2)}) exceeds threshold (${this.config.modifiedZScoreThreshold})`,
      };
    }

    if (zScore >= this.config.modifiedZScoreThreshold || isEmaBreached) {
      return {
        isAnomaly: true,
        severity: "mild_deviation",
        value,
        timestamp,
        zScore: Math.round(zScore * 100) / 100,
        ema: this.ema !== null ? Math.round(this.ema * 10) / 10 : null,
        baselineMedian: Math.round(median * 10) / 10,
        mad: Math.round(mad * 100) / 100,
        rateOfChange,
        reason: `Mild deviation detected: Modified Z-score (${zScore.toFixed(2)}) exceeds threshold (${this.config.modifiedZScoreThreshold})`,
      };
    }

    return {
      isAnomaly: false,
      severity: "normal",
      value,
      timestamp,
      zScore: Math.round(zScore * 100) / 100,
      ema: this.ema !== null ? Math.round(this.ema * 10) / 10 : null,
      baselineMedian: Math.round(median * 10) / 10,
      mad: Math.round(mad * 100) / 100,
      rateOfChange,
    };
  }

  public getBaselineStats(): BaselineStats {
    const values = this.window.map((p) => p.value);
    const count = values.length;

    if (count === 0) {
      return {
        sampleCount: 0,
        median: null,
        mad: null,
        ema: null,
        mean: null,
        stdDev: null,
        min: null,
        max: null,
      };
    }

    const median = calculateMedian(values);
    const mad = calculateMAD(values, median);
    const mean = values.reduce((a, b) => a + b, 0) / count;
    const stdDev = calculateStandardDeviation(values, mean);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      sampleCount: count,
      median: Math.round(median * 10) / 10,
      mad: Math.round(mad * 100) / 100,
      ema: this.ema !== null ? Math.round(this.ema * 10) / 10 : null,
      mean: Math.round(mean * 10) / 10,
      stdDev: Math.round(stdDev * 100) / 100,
      min,
      max,
    };
  }

  public reset(): void {
    this.window = [];
    this.ema = null;
  }
}
