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
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  const valid = samples.filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  if (valid.length < 2) return 0;

  let totalDelta = 0;
  for (let i = 1; i < valid.length; i += 1) {
    totalDelta += Math.abs(valid[i] - valid[i - 1]);
  }

  const denominator = valid.length - 1;
  if (denominator <= 0) return 0;
  const avgDelta = totalDelta / denominator;
  const result = Math.round(avgDelta * 10) / 10;
  return Number.isFinite(result) ? result : 0;
}

/**
 * Computes Exponential Moving Average (EMA) smoothed jitter with 3-sigma outlier rejection.
 * Prevents erratic telemetry fluctuations caused by synthetic ping spikes or transient radio interference.
 */
export function computeSmoothedJitter(
  samples: number[],
  options: SmoothedJitterOptions = {},
): number {
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  const valid = samples.filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  if (valid.length < 2) return 0;

  const rawAlpha = options.alpha ?? 0.2;
  const safeAlpha = Number.isFinite(rawAlpha) ? rawAlpha : 0.2;
  const alpha = Math.min(1.0, Math.max(0.01, safeAlpha));

  const rawSigma = options.outlierSigmaMultiplier ?? 3.0;
  const safeSigma = Number.isFinite(rawSigma) ? rawSigma : 3.0;
  const sigmaMultiplier = Math.max(1.0, safeSigma);

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
  const stdDev = Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : 0;

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
      if (filteredDeltas.length === 0) filteredDeltas = [Number.isFinite(mean) ? mean : 0];
    }
  } else {
    filteredDeltas = deltas;
  }

  if (filteredDeltas.length === 0) return 0;

  // 4. Compute Exponential Moving Average (EMA)
  let ema = filteredDeltas[0];
  for (let t = 1; t < filteredDeltas.length; t += 1) {
    ema = alpha * filteredDeltas[t] + (1 - alpha) * ema;
  }

  const result = Math.round(ema * 10) / 10;
  return Number.isFinite(result) ? result : 0;
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
  const valid = Array.isArray(samples)
    ? samples.filter(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      )
    : [];
  const sampleCount = valid.length;
  const rawAvg =
    sampleCount > 0
      ? valid.reduce((acc, v) => acc + v, 0) / sampleCount
      : 0;
  const avgPingMs = Number.isFinite(rawAvg) ? Math.round(rawAvg * 10) / 10 : 0;
  const rawJitter = calculateJitterMs(valid);
  const jitterMs = Number.isFinite(rawJitter) ? rawJitter : 0;
  const rawSmoothed = computeSmoothedJitter(valid, options);
  const smoothedJitterMs = Number.isFinite(rawSmoothed) ? rawSmoothed : 0;
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
