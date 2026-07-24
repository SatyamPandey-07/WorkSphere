/**
 * Federated venue trainer Web Worker (#1022).
 *
 * Runs SGD gradient updates + personalized scoring off the main thread.
 * Model weights persist in IndexedDB; raw telemetry never leaves the device.
 */

import {
  configureOnnxWasm,
  featuresToOnnxTensor,
  warmupOnnxWasm,
} from "../lib/federated/onnxBridge";
import {
  createInitialModel,
  featuresFromArray,
  scoreVenue,
  trainBatch,
  type LinearVenueModelState,
} from "../lib/federated/linearVenueModel";
import { loadWeights, saveWeights } from "../lib/federated/weightDb";
import {
  FEATURE_DIM,
  type FederatedWorkerRequest,
  type FederatedWorkerResponse,
} from "../lib/federated/types";

let model: LinearVenueModelState | null = null;

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
        const steps = trainBatch(m, examples);
        await persist();
        reply({ type: "trained", id: msg.id, steps });
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
