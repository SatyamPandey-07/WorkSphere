export type JitterTier = "excellent" | "fair" | "poor";

export interface JitterTelemetrySummary {
  sampleCount: number;
  avgPingMs: number;
  jitterMs: number;
  smoothedJitterMs: number;
  tier: JitterTier;
  statusLabel: string;
  guidanceText: string;
}

export interface SmoothedJitterOptions {
  /** EMA smoothing weight factor between 0.01 and 1.0 (default: 0.2) */
  alpha?: number;
  /** Standard deviation multiplier for outlier detection (default: 3.0) */
  outlierSigmaMultiplier?: number;
  /** Whether to clamp outliers to the 3-sigma boundary instead of dropping them (default: true) */
  clampOutliers?: boolean;
}

export function calculateJitterMs(samples: number[]): number {
  const valid = samples.filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  if (valid.length < 2) return 0;

  let totalDelta = 0;
  for (let i = 1; i < valid.length; i += 1) {
    totalDelta += Math.abs(valid[i] - valid[i - 1]);
  }

  const avgDelta = totalDelta / (valid.length - 1);
  return Math.round(avgDelta * 10) / 10;
}

/**
 * Computes Exponential Moving Average (EMA) smoothed jitter with 3-sigma outlier rejection.
 * Prevents erratic telemetry fluctuations caused by synthetic ping spikes or transient radio interference.
 */
export function computeSmoothedJitter(
  samples: number[],
  options: SmoothedJitterOptions = {},
): number {
  const valid = samples.filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  if (valid.length < 2) return 0;

  const alpha = Math.min(1.0, Math.max(0.01, options.alpha ?? 0.2));
  const sigmaMultiplier = Math.max(1.0, options.outlierSigmaMultiplier ?? 3.0);
  const clampOutliers = options.clampOutliers ?? true;

  // 1. Calculate raw successive deltas
  const deltas: number[] = [];
  for (let i = 1; i < valid.length; i += 1) {
    deltas.push(Math.abs(valid[i] - valid[i - 1]));
  }

  if (deltas.length === 0) return 0;

  // 2. Compute mean and standard deviation of deltas for 3-sigma rejection
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  const variance =
    deltas.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / deltas.length;
  const stdDev = Math.sqrt(variance);

  const upperLimit = mean + sigmaMultiplier * stdDev;
  const lowerLimit = Math.max(0, mean - sigmaMultiplier * stdDev);

  // 3. Filter or clamp outliers
  let filteredDeltas: number[];
  if (stdDev > 0) {
    if (clampOutliers) {
      filteredDeltas = deltas.map((d) =>
        Math.min(upperLimit, Math.max(lowerLimit, d)),
      );
    } else {
      filteredDeltas = deltas.filter((d) => d <= upperLimit && d >= lowerLimit);
      if (filteredDeltas.length === 0) filteredDeltas = [mean];
    }
  } else {
    filteredDeltas = deltas;
  }

  // 4. Compute Exponential Moving Average (EMA)
  let ema = filteredDeltas[0];
  for (let t = 1; t < filteredDeltas.length; t += 1) {
    ema = alpha * filteredDeltas[t] + (1 - alpha) * ema;
  }

  return Math.round(ema * 10) / 10;
}

export function classifyJitterTier(jitterMs: number): {
  tier: JitterTier;
  statusLabel: string;
  guidanceText: string;
} {
  const safeJitter = Number.isFinite(jitterMs) && jitterMs >= 0 ? jitterMs : 0;

  if (safeJitter < 15) {
    return {
      tier: "excellent",
      statusLabel: "Excellent for Video Calls",
      guidanceText:
        "Steady response times keep Zoom, Google Meet, and voice calls smooth with minimal drop risk.",
    };
  }

  if (safeJitter <= 45) {
    return {
      tier: "fair",
      statusLabel: "Good for Browsing & Streaming",
      guidanceText:
        "Fine for web apps, cloud docs, and video streaming; occasional lag spikes may occur on live calls.",
    };
  }

  return {
    tier: "poor",
    statusLabel: "High Jitter — Audio/Video May Stutter",
    guidanceText:
      "Large swings in ping delay can cause frozen video, robotic audio, or disconnects in calls and games.",
  };
}

export function summarizePingTelemetry(
  samples: number[],
  options: SmoothedJitterOptions = {},
): JitterTelemetrySummary {
  const valid = samples.filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  const sampleCount = valid.length;
  const avgPingMs =
    sampleCount > 0
      ? Math.round((valid.reduce((acc, v) => acc + v, 0) / sampleCount) * 10) /
        10
      : 0;
  const jitterMs = calculateJitterMs(valid);
  const smoothedJitterMs = computeSmoothedJitter(valid, options);
  const { tier, statusLabel, guidanceText } = classifyJitterTier(jitterMs);

  return {
    sampleCount,
    avgPingMs,
    jitterMs,
    smoothedJitterMs,
    tier,
    statusLabel,
    guidanceText,
  };
}
