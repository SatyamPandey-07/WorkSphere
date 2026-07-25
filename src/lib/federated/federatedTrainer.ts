/**
 * Main-thread client for the federated venue trainer worker (#1022).
 *
 * Personalized scoring and gradient updates stay on-device — no raw
 * telemetry is posted to any backend.
 */

import type {
  FederatedWorkerRequest,
  FederatedWorkerResponse,
  ScoredVenue,
  VenueFeatureVector,
} from "./types";
import { VENUE_FEATURE_KEYS } from "./types";
import { featuresFromVector } from "./linearVenueModel";

type Pending = {
  resolve: (value: FederatedWorkerResponse) => void;
  reject: (reason: Error) => void;
};

export class FederatedVenueTrainer {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private ready = false;

  async init(learningRate?: number): Promise<void> {
    if (typeof Worker === "undefined") {
      throw new Error("Web Workers are not available in this environment");
    }

    if (!this.worker) {
      const workerUrl = new URL(
        "../../workers/federatedTrainer.worker.ts",
        import.meta.url,
      );
      this.worker = new Worker(workerUrl, { type: "module" });
      this.worker.onmessage = (event: MessageEvent<FederatedWorkerResponse>) => {
        const msg = event.data;
        const wait = this.pending.get(msg.id);
        if (!wait) return;
        this.pending.delete(msg.id);
        if (msg.type === "error") {
          wait.reject(new Error(msg.error));
        } else {
          wait.resolve(msg);
        }
      };
      this.worker.onerror = (err) => {
        for (const [, wait] of this.pending) {
          wait.reject(new Error(err.message || "Federated worker error"));
        }
        this.pending.clear();
      };
    }

    const res = await this.send({
      type: "init",
      id: this.nextId(),
      learningRate,
    });
    if (res.type !== "ready") {
      throw new Error("Federated trainer failed to initialize");
    }
    this.ready = true;
  }

  /**
   * Score venues locally. Returns id + score sorted descending.
   * Does not transmit features or scores to any server.
   */
  async scoreVenues(
    venues: Array<{ id: string; features: VenueFeatureVector | number[] }>,
  ): Promise<ScoredVenue[]> {
    await this.ensureReady();
    const payload = venues.map((v) => ({
      id: v.id,
      features: Array.isArray(v.features)
        ? v.features
        : Array.from(featuresFromVector(v.features)),
    }));
    const res = await this.send({
      type: "score",
      id: this.nextId(),
      venues: payload,
    });
    if (res.type !== "scores") {
      throw new Error("Unexpected score response");
    }
    return res.scores;
  }

  /** Apply on-device SGD updates from private engagement labels. */
  async train(
    examples: Array<{
      features: VenueFeatureVector | number[];
      label: 0 | 1;
    }>,
  ): Promise<number> {
    await this.ensureReady();
    const res = await this.send({
      type: "train",
      id: this.nextId(),
      examples: examples.map((ex) => ({
        features: Array.isArray(ex.features)
          ? ex.features
          : Array.from(featuresFromVector(ex.features)),
        label: ex.label,
      })),
    });
    if (res.type !== "trained") {
      throw new Error("Unexpected train response");
    }
    return res.steps;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.pending.clear();
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) await this.init();
  }

  private nextId(): string {
    this.seq += 1;
    return `fed-${this.seq}-${Date.now()}`;
  }

  private send(
    msg: FederatedWorkerRequest,
  ): Promise<FederatedWorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not started"));
        return;
      }
      this.pending.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }
}

export function emptyFeatureVector(): VenueFeatureVector {
  const v = {} as VenueFeatureVector;
  for (const key of VENUE_FEATURE_KEYS) {
    v[key] = 0.5;
  }
  return v;
}
