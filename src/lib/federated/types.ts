/**
 * Federated venue recommendation trainer — shared types (#1022).
 *
 * Feature layout mirrors the amenity vector used by federated k-means
 * so preference signals stay consistent across client-side ML paths.
 */

export const VENUE_FEATURE_KEYS = [
  "wifiQuality",
  "hasOutlets",
  "outletDensity",
  "noiseLevel",
  "hasErgonomic",
  "hasPhoneBooths",
  "hasNoMusic",
  "hasQuietZone",
  "hasAncHeadsetRental",
  "lighting",
  "currentOccupancy",
  "rating",
] as const;

export type VenueFeatureKey = (typeof VENUE_FEATURE_KEYS)[number];
export const FEATURE_DIM = VENUE_FEATURE_KEYS.length;

import type { PrivacyBudget, PrivacyReport } from "./privacyAccountant";
import type { AdaptiveClippingConfig } from "./adaptiveClipping";

export const DEFAULT_LEARNING_RATE = 0.05;

/** DP-SGD settings applied to every on-device gradient step (#1563). */
export type DifferentialPrivacyConfig = {
  /** When false, plain SGD is used (no clipping, no noise). */
  enabled: boolean;
  /** Per-example L2 clipping bound C — the sensitivity of one update. */
  maxGradNorm: number;
  /** Noise std is `noiseMultiplier * maxGradNorm` (σ in DP-SGD). */
  noiseMultiplier: number;
  /**
   * Target (ε, δ) over `plannedRounds` train calls (#3359). When set, the
   * noise multiplier is calibrated from it each round and training is
   * refused once the budget is spent; `noiseMultiplier` is then ignored.
   */
  budget?: PrivacyBudget;
  /**
   * Adaptive clipping toward a gradient-norm quantile (#3359). `true` uses
   * the defaults; `maxGradNorm` is then only the starting bound.
   */
  adaptiveClipping?: boolean | Partial<AdaptiveClippingConfig>;
  /** δ used to report ε when no budget is set. Default 1e-5. */
  reportingDelta?: number;
};

export const DEFAULT_DP_CONFIG: DifferentialPrivacyConfig = {
  enabled: true,
  maxGradNorm: 1.0,
  noiseMultiplier: 1.0,
};
export const WEIGHT_DB_NAME = "federated-venue-weights";
export const WEIGHT_STORE = "modelWeights";
export const WEIGHT_KEY = "latest";

export type VenueFeatureVector = Record<VenueFeatureKey, number>;

export type ScoredVenue = {
  id: string;
  score: number;
};

export type VenueTrainExample = {
  features: Float32Array;
  /** 1 = positive engagement (click/save), 0 = ignore/dismiss */
  label: 0 | 1;
};

export type FederatedWorkerRequest =
  | {
      type: "init";
      id: string;
      learningRate?: number;
      dp?: Partial<DifferentialPrivacyConfig>;
    }
  | {
      type: "score";
      id: string;
      venues: Array<{ id: string; features: number[] }>;
    }
  | {
      type: "train";
      id: string;
      examples: Array<{ features: number[]; label: 0 | 1 }>;
    }
  | { type: "getWeights"; id: string }
  | { type: "privacy"; id: string };

export type FederatedWorkerResponse =
  | { type: "ready"; id: string; weightCount: number }
  | { type: "scores"; id: string; scores: ScoredVenue[] }
  | {
      type: "trained";
      id: string;
      steps: number;
      /** Cumulative privacy loss after this round (#3359). */
      privacy?: PrivacyReport;
      clipNorm?: number;
    }
  | { type: "privacy"; id: string; privacy: PrivacyReport; clipNorm: number }
  | { type: "weights"; id: string; weights: number[]; bias: number }
  | { type: "error"; id: string; error: string };
