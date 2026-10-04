/**
 * Lightweight linear venue scorer with SGD fine-tuning (#1022).
 *
 * Acts as the trainable "last layer" head described in the federated
 * learning privacy guide. Gradient steps stay on-device; no telemetry
 * is required to score or update.
 */

import {
  addGaussianNoise,
  clipByL2Norm,
  secureRandom,
  type RandomSource,
} from "./differentialPrivacy";
import {
  nextClipNorm,
  noisyUnclippedFraction,
  type AdaptiveClippingConfig,
} from "./adaptiveClipping";
import type { RoundMultipliers } from "./privacyAccountant";
import {
  DEFAULT_LEARNING_RATE,
  FEATURE_DIM,
  VENUE_FEATURE_KEYS,
  type DifferentialPrivacyConfig,
  type VenueFeatureVector,
  type VenueTrainExample,
} from "./types";

export type LinearVenueModelState = {
  weights: Float32Array;
  bias: number;
  learningRate: number;
};

export function createInitialModel(
  learningRate = DEFAULT_LEARNING_RATE,
): LinearVenueModelState {
  // Small random init so early scores aren't all identical
  const weights = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) {
    weights[i] = (Math.random() - 0.5) * 0.02;
  }
  return { weights, bias: 0, learningRate };
}

export function featuresFromVector(vector: VenueFeatureVector): Float32Array {
  const out = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) {
    const key = VENUE_FEATURE_KEYS[i];
    const v = vector[key];
    out[i] = Number.isFinite(v) ? clamp01(v) : 0.5;
  }
  return out;
}

export function featuresFromArray(values: number[]): Float32Array {
  const out = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? clamp01(v) : 0.5;
  }
  return out;
}

export function sigmoid(x: number): number {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Personalized venue score in [0, 1]. */
export function scoreVenue(
  model: LinearVenueModelState,
  features: Float32Array,
): number {
  let logit = model.bias;
  const n = Math.min(model.weights.length, features.length);
  for (let i = 0; i < n; i++) {
    logit += model.weights[i] * features[i];
  }
  return sigmoid(logit);
}

/**
 * Binary cross-entropy gradient for one example, laid out as
 * [dL/dw_0 … dL/dw_{n-1}, dL/db] so clipping covers weights and bias jointly.
 */
export function computeGradient(
  model: LinearVenueModelState,
  example: VenueTrainExample,
): { gradient: Float32Array; loss: number } {
  const pred = scoreVenue(model, example.features);
  const error = pred - example.label;

  const n = model.weights.length;
  const gradient = new Float32Array(n + 1);
  const m = Math.min(n, example.features.length);
  for (let i = 0; i < m; i++) {
    gradient[i] = error * example.features[i];
  }
  gradient[n] = error;

  const eps = 1e-7;
  const y = example.label;
  const loss = -(y * Math.log(pred + eps) + (1 - y) * Math.log(1 - pred + eps));
  return { gradient, loss };
}

function applyGradient(model: LinearVenueModelState, gradient: Float32Array): void {
  const lr = model.learningRate;
  const n = model.weights.length;
  for (let i = 0; i < n; i++) {
    model.weights[i] -= lr * gradient[i];
  }
  model.bias -= lr * gradient[n];
}

/**
 * One SGD step on binary cross-entropy for a single engagement label.
 * Returns the scalar loss for diagnostics.
 */
export function sgdStep(
  model: LinearVenueModelState,
  example: VenueTrainExample,
): number {
  const { gradient, loss } = computeGradient(model, example);
  applyGradient(model, gradient);
  return loss;
}

/**
 * One DP-SGD step (#1563): clip the example's gradient to `maxGradNorm`,
 * add N(0, (noiseMultiplier * maxGradNorm)²) noise, then apply it.
 * Returns the scalar loss for diagnostics.
 */
export function dpSgdStep(
  model: LinearVenueModelState,
  example: VenueTrainExample,
  dp: DifferentialPrivacyConfig,
  random: RandomSource = secureRandom,
): number {
  const { gradient, loss } = computeGradient(model, example);
  clipByL2Norm(gradient, dp.maxGradNorm);
  addGaussianNoise(gradient, dp.noiseMultiplier * dp.maxGradNorm, random);
  applyGradient(model, gradient);
  return loss;
}

export function trainBatch(
  model: LinearVenueModelState,
  examples: VenueTrainExample[],
  dp?: DifferentialPrivacyConfig,
  random?: RandomSource,
): number {
  let steps = 0;
  for (const ex of examples) {
    if (dp?.enabled) {
      dpSgdStep(model, ex, dp, random);
    } else {
      sgdStep(model, ex);
    }
    steps += 1;
  }
  return steps;
}

export interface DpRoundResult {
  steps: number;
  /** Clip bound used this round. */
  clipNorm: number;
  /** Clip bound for the next round (unchanged without adaptive clipping). */
  nextClipNorm: number;
  /** Privatised unclipped fraction (only with adaptive clipping). */
  noisyUnclippedFraction?: number;
}

/**
 * One DP-SGD training round (#3359): every example gets one step with its
 * gradient clipped to `clipNorm` and N(0, (z·clipNorm)²) noise added. With
 * adaptive clipping, the round also releases a noisy count of unclipped
 * gradients and moves the bound toward the target quantile.
 *
 * Privacy: each example is used once, so the round is one Gaussian release
 * with multiplier `noiseMultiplier` (plus one count release with
 * `countNoiseMultiplier`). Charge exactly those to the PrivacyAccountant.
 */
export function trainDpRound(
  model: LinearVenueModelState,
  examples: VenueTrainExample[],
  round: RoundMultipliers & { clipNorm: number },
  adaptive?: AdaptiveClippingConfig,
  random: RandomSource = secureRandom,
): DpRoundResult {
  const { clipNorm, noiseMultiplier, countNoiseMultiplier } = round;
  if (!(clipNorm > 0) || !(noiseMultiplier > 0)) {
    throw new RangeError("clipNorm and noiseMultiplier must be positive");
  }
  if (adaptive && !(countNoiseMultiplier! > 0)) {
    throw new RangeError("Adaptive clipping needs a countNoiseMultiplier");
  }

  let unclipped = 0;
  for (const example of examples) {
    const { gradient } = computeGradient(model, example);
    const norm = clipByL2Norm(gradient, clipNorm);
    if (norm <= clipNorm) unclipped += 1;
    addGaussianNoise(gradient, noiseMultiplier * clipNorm, random);
    applyGradient(model, gradient);
  }

  if (!adaptive || examples.length === 0) {
    return { steps: examples.length, clipNorm, nextClipNorm: clipNorm };
  }
  const fraction = noisyUnclippedFraction(unclipped, examples.length, countNoiseMultiplier!, random);
  return {
    steps: examples.length,
    clipNorm,
    nextClipNorm: nextClipNorm(clipNorm, fraction, adaptive),
    noisyUnclippedFraction: fraction,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
