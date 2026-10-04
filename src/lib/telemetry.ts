"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface TelemetrySmootherOptions {
  /** Smoothing factor alpha in range [0.1, 0.4]. Defaults to 0.25. */
  alpha?: number;
  /** Number of historical readings for 3-sigma calculation. Defaults to 10. */
  windowSize?: number;
  /** Sigma multiplier threshold for outlier detection. Defaults to 3. */
  sigmaThreshold?: number;
}

export interface SmoothedTelemetryResult {
  smoothed: number;
  raw: number;
  isOutlier: boolean;
  history: number[];
}

/**
 * Calculates the mean and population standard deviation of an array of values.
 */
export function computeMeanAndStdDev(values: number[]): {
  mean: number;
  stdDev: number;
} {
  if (!values || values.length === 0) {
    return { mean: 0, stdDev: 0 };
  }
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Checks if a candidate measurement is an outlier using 3-sigma rule:
 * |Y_t - mu| > 3 * sigma over the historical readings.
 */
export function isOutlier3Sigma(
  value: number,
  history: number[],
  sigmaThreshold = 3,
): boolean {
  if (!history || history.length < 3) {
    return false;
  }
  const { mean, stdDev } = computeMeanAndStdDev(history);

  // If variance is negligible, flag only if deviation is substantial compared to baseline
  if (stdDev < 1e-6) {
    return Math.abs(value - mean) > Math.max(1.0, mean * 0.5);
  }

  return Math.abs(value - mean) > sigmaThreshold * stdDev;
}

/**
 * Computes Exponential Moving Average:
 * S_t = alpha * Y_t + (1 - alpha) * S_{t-1}
 */
export function calculateEMA(
  currentVal: number,
  prevEMA: number | null,
  alpha = 0.25,
): number {
  const clampedAlpha = Math.min(0.4, Math.max(0.1, alpha));
  if (prevEMA === null || Number.isNaN(prevEMA)) {
    return currentVal;
  }
  return clampedAlpha * currentVal + (1.0 - clampedAlpha) * prevEMA;
}

/**
 * Stateful Telemetry Smoother combining 3-sigma outlier rejection
 * with Exponential Moving Average (EMA).
 */
export class TelemetrySmoother {
  private alpha: number;
  private windowSize: number;
  private sigmaThreshold: number;
  private currentEMA: number | null = null;
  private history: number[] = [];

  constructor(options: TelemetrySmootherOptions = {}) {
    const rawAlpha = options.alpha ?? 0.25;
    this.alpha = Math.min(0.4, Math.max(0.1, rawAlpha));
    this.windowSize = Math.max(3, options.windowSize ?? 10);
    this.sigmaThreshold = Math.max(1, options.sigmaThreshold ?? 3);
  }

  public update(rawValue: number): SmoothedTelemetryResult {
    if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
      return {
        smoothed: this.currentEMA ?? 0,
        raw: rawValue,
        isOutlier: false,
        history: [...this.history],
      };
    }

    // 1. Check for 3-sigma outlier
    const isOutlier = isOutlier3Sigma(
      rawValue,
      this.history,
      this.sigmaThreshold,
    );

    if (isOutlier) {
      // Discard outlier: do not incorporate into EMA or history buffer
      return {
        smoothed: this.currentEMA ?? rawValue,
        raw: rawValue,
        isOutlier: true,
        history: [...this.history],
      };
    }

    // 2. Compute Exponential Moving Average
    this.currentEMA = calculateEMA(rawValue, this.currentEMA, this.alpha);

    // 3. Update sliding window history (up to windowSize entries)
    this.history.push(rawValue);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return {
      smoothed: this.currentEMA,
      raw: rawValue,
      isOutlier: false,
      history: [...this.history],
    };
  }

  public getSmoothed(): number {
    return this.currentEMA ?? 0;
  }

  public getHistory(): number[] {
    return [...this.history];
  }

  public reset(): void {
    this.currentEMA = null;
    this.history = [];
  }
}

/**
 * React hook for smooth telemetry metrics.
 * Rejects 3-sigma ping spikes and smoothly animates WiFi speed updates via EMA.
 */
export function useSmoothTelemetry(
  rawSpeedMbps: number,
  options: TelemetrySmootherOptions = {},
): {
  smoothedSpeed: number;
  isOutlier: boolean;
  history: number[];
  reset: () => void;
} {
  const smootherRef = useRef<TelemetrySmoother | null>(null);
  if (!smootherRef.current) {
    smootherRef.current = new TelemetrySmoother(options);
  }

  const [state, setState] = useState<{
    smoothedSpeed: number;
    isOutlier: boolean;
    history: number[];
  }>(() => {
    const res = smootherRef.current!.update(rawSpeedMbps);
    return {
      smoothedSpeed: res.smoothed,
      isOutlier: res.isOutlier,
      history: res.history,
    };
  });

  const prevRawRef = useRef(rawSpeedMbps);

  useEffect(() => {
    if (smootherRef.current && prevRawRef.current !== rawSpeedMbps) {
      prevRawRef.current = rawSpeedMbps;
      const res = smootherRef.current.update(rawSpeedMbps);
      setState({
        smoothedSpeed: res.smoothed,
        isOutlier: res.isOutlier,
        history: res.history,
      });
    }
  }, [rawSpeedMbps]);

  const reset = useCallback(() => {
    smootherRef.current?.reset();
    if (smootherRef.current) {
      const res = smootherRef.current.update(rawSpeedMbps);
      setState({
        smoothedSpeed: res.smoothed,
        isOutlier: res.isOutlier,
        history: res.history,
      });
    }
  }, [rawSpeedMbps]);

  return {
    smoothedSpeed: state.smoothedSpeed,
    isOutlier: state.isOutlier,
    history: state.history,
    reset,
  };
}
