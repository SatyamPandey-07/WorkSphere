/**
 * Adaptive L2 clipping for DP-SGD (#3359), after Andrew et al.,
 * "Differentially Private Learning with Adaptive Clipping" (NeurIPS 2021).
 *
 * A fixed clip bound either cuts informative gradients (too low) or adds
 * needless noise and lets outliers dominate (too high). Instead the bound
 * tracks a target quantile γ of per-example gradient norms:
 *
 *     b̃  = (#{‖g‖ ≤ C} + N(0, z_b²)) / m          (private, sensitivity 1)
 *     C ← clamp(C · exp(−η · (b̃ − γ)), C_min, C_max)
 *
 * The count is released with Gaussian noise, so learning the bound costs
 * privacy too; the accountant charges it (see privacyAccountant.ts). The
 * clamp is what stops a run of huge gradients from exploding the bound.
 */

import { sampleStandardNormal, secureRandom, type RandomSource } from "./differentialPrivacy";

export interface AdaptiveClippingConfig {
  /** Fraction of per-example gradients that should end up unclipped. Default 0.5 (median). */
  targetQuantile: number;
  /** Geometric step size η. Default 0.2. */
  learningRate: number;
  initialClipNorm: number;
  minClipNorm: number;
  maxClipNorm: number;
  /** Share of each round's privacy budget spent on the count query. Default 0.1. */
  countBudgetShare: number;
}

export const DEFAULT_ADAPTIVE_CLIPPING: AdaptiveClippingConfig = {
  targetQuantile: 0.5,
  learningRate: 0.2,
  initialClipNorm: 1.0,
  minClipNorm: 0.01,
  maxClipNorm: 10,
  countBudgetShare: 0.1,
};

export function resolveAdaptiveClipping(
  overrides: Partial<AdaptiveClippingConfig> = {},
): AdaptiveClippingConfig {
  const c = { ...DEFAULT_ADAPTIVE_CLIPPING, ...overrides };
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!(c.targetQuantile > 0 && c.targetQuantile < 1)) {
    throw new RangeError("targetQuantile must be in (0, 1)");
  }
  if (!positive(c.learningRate)) throw new RangeError("learningRate must be positive");
  if (!positive(c.minClipNorm) || !positive(c.maxClipNorm) || c.minClipNorm > c.maxClipNorm) {
    throw new RangeError("Need 0 < minClipNorm ≤ maxClipNorm");
  }
  if (!(c.initialClipNorm >= c.minClipNorm && c.initialClipNorm <= c.maxClipNorm)) {
    throw new RangeError("initialClipNorm must lie within [minClipNorm, maxClipNorm]");
  }
  if (!(c.countBudgetShare > 0 && c.countBudgetShare < 1)) {
    throw new RangeError("countBudgetShare must be in (0, 1)");
  }
  return c;
}

/** Privatised fraction of examples whose gradient norm was ≤ the clip bound. */
export function noisyUnclippedFraction(
  unclippedCount: number,
  total: number,
  countNoiseMultiplier: number,
  random: RandomSource = secureRandom,
): number {
  if (total <= 0) return 0;
  return (unclippedCount + countNoiseMultiplier * sampleStandardNormal(random)) / total;
}

/** One geometric update of the clip bound toward the target quantile. */
export function nextClipNorm(
  clipNorm: number,
  noisyFraction: number,
  config: AdaptiveClippingConfig,
): number {
  const updated = clipNorm * Math.exp(-config.learningRate * (noisyFraction - config.targetQuantile));
  return Math.min(config.maxClipNorm, Math.max(config.minClipNorm, updated));
}
