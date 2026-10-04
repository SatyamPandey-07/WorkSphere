"use client";

import { computeMembershipCommit } from "@/lib/zkp/commitment";
import type { ZkProofPayload } from "@/lib/zkp/verify";
import {
  getOrCreateProof,
  invalidateProof,
  storeProof,
  type CachedProof,
  type ProofSource,
} from "@/lib/zkp/proofCache";

export type ZkpProgressStage = "generating" | "verifying";

export type ZkpAccessResult = {
  allowed: boolean;
  proveMs: number;
  accessToken?: string;
  error?: string;
  /** Where the proof came from: IndexedDB cache or a fresh snarkjs run (#3358). */
  proofSource?: ProofSource;
  /** Whether the Groth16 witness and proof were accelerated via WebAssembly SIMD. */
  simdAccelerated?: boolean;
};

const PROOF_TIMEOUT_MS = 60_000;

/** Proof-cache scope for the premium membership circuit. */
export const PREMIUM_PROOF_SCOPE = "premium-membership";

function createZkpWorker(): Worker {
  return new Worker(
    new URL("../../workers/zkpWorker.ts", import.meta.url),
  );
}

class ProofGenerationError extends Error {}

/**
 * Run snarkjs proving in a dedicated WebWorker (WASM off the main thread).
 * Rejects with a user-facing message on error, timeout or abort.
 */
export function generateMembershipProof(input: {
  identityToken: string;
  expectedCommit: string;
  onProgress?: (stage: ZkpProgressStage) => void;
  signal?: AbortSignal;
}): Promise<CachedProof> {
  const { identityToken, expectedCommit, onProgress, signal } = input;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProofGenerationError("Aborted."));
      return;
    }

    let worker: Worker | null = createZkpWorker();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (error?: string, proof?: CachedProof) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      worker?.terminate();
      worker = null;
      signal?.removeEventListener("abort", onAbort);
      if (proof) resolve(proof);
      else reject(new ProofGenerationError(error ?? "Could not build proof."));
    };

    const onAbort = () => {
      worker?.postMessage({ type: "cancel" });
      finish("Aborted.");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    timeoutId = setTimeout(() => {
      worker?.postMessage({ type: "cancel" });
      finish("Proof generation timed out.");
    }, PROOF_TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      if (type === "progress") {
        onProgress?.(e.data.stage as ZkpProgressStage);
      } else if (type === "error") {
        finish(e.data.error ?? "Could not build proof.");
      } else if (type === "success") {
        const { proof, publicSignals } = e.data as {
          proof: ZkProofPayload["proof"];
          publicSignals: string[];
        };
        finish(undefined, { proof, publicSignals });
      }
    };

    worker.onerror = () => finish("Worker crashed during proof generation.");

    worker.postMessage({ type: "prove", identityToken, expectedCommit });
  });
}

async function submitProof(
  venueId: string,
  proof: CachedProof,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`/api/venues/${venueId}/zkp-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof: proof.proof, publicSignals: proof.publicSignals }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** The server rejected the proof or credential itself, so the cached copy must go. */
const isCredentialRejection = (status: number) => status === 400 || status === 403;

/**
 * Browser-only: obtains a zk-SNARK membership proof (from the IndexedDB
 * proof cache when possible, otherwise generated in a WebWorker), then POSTs
 * proof + publicSignals to the server, which verifies and returns a signed
 * venue access token.
 */
export async function provePremiumAccess(input: {
  identityToken: string;
  venueId: string;
  onProgress?: (stage: ZkpProgressStage) => void;
  signal?: AbortSignal;
}): Promise<ZkpAccessResult> {
  const { identityToken, venueId, onProgress, signal } = input;
  if (signal?.aborted) return { allowed: false, proveMs: 0, error: "Aborted." };

  const commit = computeMembershipCommit(identityToken);
  const generate = () =>
    generateMembershipProof({ identityToken, expectedCommit: commit, onProgress, signal });

  const started = Date.now();
  let proof: CachedProof;
  let proofSource: ProofSource;
  try {
    const result = await getOrCreateProof({ scope: PREMIUM_PROOF_SCOPE, commit, generate });
    proof = result;
    proofSource = result.source;
  } catch (err) {
    return {
      allowed: false,
      proveMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Could not build proof.",
    };
  }
  let proveMs = Date.now() - started;

  if (signal?.aborted) return { allowed: false, proveMs, error: "Aborted.", proofSource };
  onProgress?.("verifying");

  try {
    let res = await submitProof(venueId, proof);

    if (!res.ok && isCredentialRejection(res.status)) {
      await invalidateProof(PREMIUM_PROOF_SCOPE, commit);

      // A cached proof can be rejected after a key rotation the epoch didn't
      // catch; re-prove once rather than failing the user.
      if (proofSource !== "generated") {
        const retryStart = Date.now();
        try {
          proof = await generate();
        } catch (err) {
          return {
            allowed: false,
            proveMs: proveMs + (Date.now() - retryStart),
            error: err instanceof Error ? err.message : "Could not build proof.",
          };
        }
        proveMs += Date.now() - retryStart;
        proofSource = "generated";
        onProgress?.("verifying");
        res = await submitProof(venueId, proof);
        if (res.ok) await storeProof(PREMIUM_PROOF_SCOPE, commit, proof);
        else if (isCredentialRejection(res.status)) await invalidateProof(PREMIUM_PROOF_SCOPE, commit);
      }
    }

    if (!res.ok) {
      return {
        allowed: false,
        proveMs,
        error: (res.data.error as string) ?? "Verification failed.",
        proofSource,
      };
    }
    return {
      allowed: !!res.data.allowed,
      proveMs,
      accessToken: res.data.accessToken as string | undefined,
      proofSource,
    };
  } catch {
    return { allowed: false, proveMs, error: "Network error during verification.", proofSource };
  }
}
