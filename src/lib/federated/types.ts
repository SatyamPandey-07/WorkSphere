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

export const DEFAULT_LEARNING_RATE = 0.05;
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
  | { type: "init"; id: string; learningRate?: number }
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
  | { type: "getWeights"; id: string };

export type FederatedWorkerResponse =
  | { type: "ready"; id: string; weightCount: number }
  | { type: "scores"; id: string; scores: ScoredVenue[] }
  | { type: "trained"; id: string; steps: number }
  | { type: "weights"; id: string; weights: number[]; bias: number }
  | { type: "error"; id: string; error: string };
