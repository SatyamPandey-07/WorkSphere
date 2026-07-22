/**
 * Helpers for WebAudio AnalyserNode FFT spectrum / waterfall rendering.
 */

export const FFT_SIZE = 2048;
export const TARGET_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

export type NoiseClass = "Quiet" | "Moderate" | "Loud";

export function classifyNoise(db: number): NoiseClass {
  if (db < 45) return "Quiet";
  if (db <= 65) return "Moderate";
  return "Loud";
}

/**
 * Map AnalyserNode getFloatFrequencyData values (dBFS, typically ≤ 0)
 * into an approximate 20–120 dB display range used elsewhere in the app.
 */
export function peakDbFromFrequencyBins(bins: Float32Array): number {
  let peak = -Infinity;
  for (let i = 0; i < bins.length; i++) {
    const v = bins[i];
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  if (!Number.isFinite(peak)) return 20;
  return Math.max(20, Math.min(120, Math.round((peak + 100) * 10) / 10));
}

/** Average of the loudest bins — smoother live readout than a single spike. */
export function averageDbFromFrequencyBins(
  bins: Float32Array,
  topN = 8,
): number {
  if (bins.length === 0) return 20;
  const sorted = Array.from(bins)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);
  const n = Math.min(topN, sorted.length);
  if (n === 0) return 20;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const avg = sum / n;
  return Math.max(20, Math.min(120, Math.round((avg + 100) * 10) / 10));
}

/** Hot→cold color for waterfall intensity (0–1). */
export function spectrogramColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.33) {
    const k = x / 0.33;
    return [
      Math.round(10 + 20 * k),
      Math.round(20 + 100 * k),
      Math.round(80 + 120 * k),
    ];
  }
  if (x < 0.66) {
    const k = (x - 0.33) / 0.33;
    return [
      Math.round(30 + 220 * k),
      Math.round(120 + 80 * k),
      Math.round(200 - 160 * k),
    ];
  }
  const k = (x - 0.66) / 0.34;
  return [
    Math.round(250),
    Math.round(200 - 160 * k),
    Math.round(40 - 20 * k),
  ];
}

/** Normalize a dBFS bin (−100…0) to 0–1 for bar / waterfall height. */
export function normalizeBinDb(dbfs: number, minDb = -100, maxDb = -10): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.min(1, Math.max(0, (dbfs - minDb) / (maxDb - minDb)));
}
