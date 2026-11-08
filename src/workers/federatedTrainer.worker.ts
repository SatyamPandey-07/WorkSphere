/**
 * Federated venue trainer Web Worker (#1022).
 *
 * Runs DP-SGD gradient updates (#1563) + personalized scoring off the main thread.
 * Model weights persist in IndexedDB; raw telemetry never leaves the device.
 */

import {
  configureOnnxWasm,
  featuresToOnnxTensor,
  warmupOnnxWasm,
} from "../lib/federated/onnxBridge";
import { resolveDpConfig } from "../lib/federated/differentialPrivacy";
import {
  createInitialModel,
  featuresFromArray,
  scoreVenue,
  type LinearVenueModelState,
} from "../lib/federated/linearVenueModel";
import {
  loadPrivacyState,
  loadWeights,
  savePrivacyState,
  saveWeights,
} from "../lib/federated/weightDb";
import { DpTrainingSession } from "../lib/federated/dpTrainingSession";
import {
  FEATURE_DIM,
  type DifferentialPrivacyConfig,
  type FederatedWorkerRequest,
  type FederatedWorkerResponse,
} from "../lib/federated/types";

let model: LinearVenueModelState | null = null;
let dpConfig: DifferentialPrivacyConfig = resolveDpConfig();
let session: DpTrainingSession | null = null;

/** DP session restored from the persisted privacy ledger (#3359). */
async function ensureSession(): Promise<DpTrainingSession> {
  if (!session) session = new DpTrainingSession(dpConfig, await loadPrivacyState());
  return session;
}

async function ensureModel(learningRate?: number): Promise<LinearVenueModelState> {
  configureOnnxWasm();

  if (model) {
    if (learningRate !== undefined) model.learningRate = learningRate;
    return model;
  }

  const stored = await loadWeights();
  if (stored && stored.weights.length === FEATURE_DIM) {
    model = {
      weights: stored.weights,
      bias: stored.bias,
      learningRate: learningRate ?? 0.05,
    };
  } else {
    model = createInitialModel(learningRate);
  }

  await warmupOnnxWasm(model.weights);
  return model;
}

async function persist(): Promise<void> {
  if (!model) return;
  await saveWeights({
    weights: model.weights,
    bias: model.bias,
    updatedAt: Date.now(),
  });
}

function reply(msg: FederatedWorkerResponse): void {
  self.postMessage(msg);
}

self.onmessage = async (event: MessageEvent<FederatedWorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        if (msg.dp) {
          dpConfig = resolveDpConfig(msg.dp);
          session = null; // rebuilt with the new config; the ledger is kept
        }
        const m = await ensureModel(msg.learningRate);
        reply({ type: "ready", id: msg.id, weightCount: m.weights.length });
        break;
      }

      case "score": {
        const m = await ensureModel();
        const scores = msg.venues.map((venue) => {
          const features = featuresFromArray(venue.features);
          // Route features through ONNX Wasm tensor packing
          const tensor = featuresToOnnxTensor(features);
          const packed = tensor.data as Float32Array;
          return {
            id: venue.id,
            score: scoreVenue(m, packed),
          };
        });
        // Highest score first — pure client ranking
        scores.sort((a, b) => b.score - a.score);
        reply({ type: "scores", id: msg.id, scores });
        break;
      }

      case "train": {
        const m = await ensureModel();
        const examples = msg.examples.map((ex) => ({
          features: featuresFromArray(ex.features),
          label: ex.label,
        }));
        const s = await ensureSession();
        // Throws PrivacyBudgetExhaustedError (→ error reply) before training
        // when a configured (ε, δ) budget would be exceeded.
        const outcome = s.runRound(m, examples);
        // Ledger first: if we crash between the writes, the ledger
        // over-counts rather than under-counts spent privacy.
        await savePrivacyState(s.state());
        await persist();
        reply({
          type: "trained",
          id: msg.id,
          steps: outcome.steps,
          privacy: outcome.privacy,
          clipNorm: outcome.clipNorm,
        });
        break;
      }

      case "privacy": {
        const s = await ensureSession();
        reply({ type: "privacy", id: msg.id, privacy: s.report(), clipNorm: s.currentClipNorm });
        break;
      }

      case "getWeights": {
        const m = await ensureModel();
        reply({
          type: "weights",
          id: msg.id,
          weights: Array.from(m.weights),
          bias: m.bias,
        });
        break;
      }

      default:
        reply({
          type: "error",
          id: (msg as { id: string }).id,
          error: "Unknown message type",
        });
    }
  } catch (err) {
    reply({
      type: "error",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
