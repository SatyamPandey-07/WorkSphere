"use client";

import { computeMembershipCommit } from "@/lib/zkp/commitment";
import type { ZkProofPayload } from "@/lib/zkp/verify";

export type ZkpProgressStage = "generating" | "verifying";

export type ZkpAccessResult = {
  allowed: boolean;
  proveMs: number;
  accessToken?: string;
  error?: string;
};

const PROOF_TIMEOUT_MS = 60_000;

function createZkpWorker(): Worker {
  return new Worker(
    new URL("../../workers/zkpWorker.ts", import.meta.url),
  );
}

/**
 * Browser-only: generates the zk-SNARK proof inside a dedicated WebWorker
 * (snarkjs WASM runs off the main thread) then POSTs proof + publicSignals
 * to the server, which verifies and returns a signed venue access token.
 */
export function provePremiumAccess(input: {
  identityToken: string;
  venueId: string;
  onProgress?: (stage: ZkpProgressStage) => void;
  signal?: AbortSignal;
}): Promise<ZkpAccessResult> {
  return new Promise((resolve) => {
    const { identityToken, venueId, onProgress, signal } = input;

    if (signal?.aborted) {
      resolve({ allowed: false, proveMs: 0, error: "Aborted." });
      return;
    }

    let proveMs = 0;
    let worker: Worker | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
    }

    const onAbort = () => {
      worker?.postMessage({ type: "cancel" });
      cleanup();
      resolve({ allowed: false, proveMs: 0, error: "Aborted." });
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    timeoutId = setTimeout(() => {
      worker?.postMessage({ type: "cancel" });
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      resolve({
        allowed: false,
        proveMs: PROOF_TIMEOUT_MS,
        error: "Proof generation timed out.",
      });
    }, PROOF_TIMEOUT_MS);

    const expectedCommit = computeMembershipCommit(identityToken);

    worker = createZkpWorker();
    const started = Date.now();

    worker.onmessage = async (e: MessageEvent) => {
      const { type } = e.data;

      if (type === "progress") {
        onProgress?.(e.data.stage as ZkpProgressStage);
        return;
      }

      if (type === "error") {
        cleanup();
        signal?.removeEventListener("abort", onAbort);
        resolve({
          allowed: false,
          proveMs: Date.now() - started,
          error: e.data.error ?? "Could not build proof.",
        });
        return;
      }

      if (type === "success") {
        proveMs = Date.now() - started;
        onProgress?.("verifying");

        const { proof, publicSignals } = e.data as {
          proof: ZkProofPayload["proof"];
          publicSignals: string[];
        };

        cleanup();

        try {
          const res = await fetch(`/api/venues/${venueId}/zkp-access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proof, publicSignals }),
          });

          const data = await res.json().catch(() => ({}));
          signal?.removeEventListener("abort", onAbort);

          if (!res.ok) {
            resolve({
              allowed: false,
              proveMs,
              error: data.error ?? "Verification failed.",
            });
            return;
          }

          resolve({
            allowed: !!data.allowed,
            proveMs,
            accessToken: data.accessToken,
          });
        } catch {
          signal?.removeEventListener("abort", onAbort);
          resolve({
            allowed: false,
            proveMs,
            error: "Network error during verification.",
          });
        }
      }
    };

    worker.onerror = () => {
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      resolve({
        allowed: false,
        proveMs: Date.now() - started,
        error: "Worker crashed during proof generation.",
      });
    };

    worker.postMessage({
      type: "prove",
      identityToken,
      expectedCommit,
    });
  });
}
