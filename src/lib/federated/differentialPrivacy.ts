/**
 * Differential privacy primitives for the federated venue trainer (#1563).
 *
 * Implements the two DP-SGD building blocks: per-example L2 gradient
 * clipping (bounds each example's sensitivity to `maxGradNorm`) and
 * Gaussian noise calibrated to `noiseMultiplier * maxGradNorm`.
 */

import {
  DEFAULT_DP_CONFIG,
  type DifferentialPrivacyConfig,
} from "./types";
import { validateBudget } from "./privacyAccountant";
import { resolveAdaptiveClipping } from "./adaptiveClipping";

export type RandomSource = () => number;

/**
 * Uniform [0, 1) source backed by the Web Crypto API when available.
 * DP guarantees assume unpredictable noise, so Math.random is only a fallback.
 */
export function secureRandom(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 0x100000000;
  }
  return Math.random();
}

/** Standard normal sample N(0, 1) via the Box–Muller transform. */
export function sampleStandardNormal(random: RandomSource = secureRandom): number {
  let u = 0;
  // Reject 0 so log(u) stays finite
  while (u === 0) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function l2Norm(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * values[i];
  }
  return Math.sqrt(sum);
}

/**
 * Scale `grad` in place so its L2 norm is at most `maxNorm`.
 * Returns the pre-clipping norm for diagnostics.
 */
export function clipByL2Norm(grad: Float32Array, maxNorm: number): number {
  const norm = l2Norm(grad);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    for (let i = 0; i < grad.length; i++) {
      grad[i] *= scale;
    }
  }
  return norm;
}

/** Add i.i.d. N(0, stdDev²) noise to every coordinate of `values` in place. */
export function addGaussianNoise(
  values: Float32Array,
  stdDev: number,
  random: RandomSource = secureRandom,
): void {
  if (stdDev <= 0) return;
  for (let i = 0; i < values.length; i++) {
    values[i] += stdDev * sampleStandardNormal(random);
  }
}

/** Merge overrides onto defaults and reject values that would void the guarantee. */
export function resolveDpConfig(
  overrides?: Partial<DifferentialPrivacyConfig>,
): DifferentialPrivacyConfig {
  const config = { ...DEFAULT_DP_CONFIG, ...overrides };
  if (!Number.isFinite(config.maxGradNorm) || config.maxGradNorm <= 0) {
    throw new Error("maxGradNorm must be a positive finite number");
  }
  if (!Number.isFinite(config.noiseMultiplier) || config.noiseMultiplier < 0) {
    throw new Error("noiseMultiplier must be a non-negative finite number");
  }
  if (config.budget) validateBudget(config.budget);
  if (config.adaptiveClipping) {
    resolveAdaptiveClipping(config.adaptiveClipping === true ? {} : config.adaptiveClipping);
  }
  const reportingDelta = config.reportingDelta ?? 1e-5;
  if (!(reportingDelta > 0 && reportingDelta < 1)) {
    throw new Error("reportingDelta must be in (0, 1)");
  }
  return config;
}
