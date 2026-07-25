/**
 * Lightweight linear venue scorer with SGD fine-tuning (#1022).
 *
 * Acts as the trainable "last layer" head described in the federated
 * learning privacy guide. Gradient steps stay on-device; no telemetry
 * is required to score or update.
 */

import {
  DEFAULT_LEARNING_RATE,
  FEATURE_DIM,
  VENUE_FEATURE_KEYS,
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
 * One SGD step on binary cross-entropy for a single engagement label.
 * Returns the scalar loss for diagnostics.
 */
export function sgdStep(
  model: LinearVenueModelState,
  example: VenueTrainExample,
): number {
  const pred = scoreVenue(model, example.features);
  const error = pred - example.label;
  const lr = model.learningRate;

  const n = Math.min(model.weights.length, example.features.length);
  for (let i = 0; i < n; i++) {
    model.weights[i] -= lr * error * example.features[i];
  }
  model.bias -= lr * error;

  const eps = 1e-7;
  const y = example.label;
  return -(y * Math.log(pred + eps) + (1 - y) * Math.log(1 - pred + eps));
}

export function trainBatch(
  model: LinearVenueModelState,
  examples: VenueTrainExample[],
): number {
  let steps = 0;
  for (const ex of examples) {
    sgdStep(model, ex);
    steps += 1;
  }
  return steps;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
