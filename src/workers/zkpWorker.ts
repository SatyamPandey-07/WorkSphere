import * as snarkjs from "snarkjs";

interface ProofRequest {
  type: "prove";
  identityToken: string;
  expectedCommit: string;
}

interface CancelMessage {
  type: "cancel";
}

type WorkerMessage = ProofRequest | CancelMessage;

let generation = 0;

type WorkerErrorType = "oom" | "internal" | "generic";

function classifyError(error: unknown): WorkerErrorType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (
      msg.includes("out of memory") ||
      msg.includes("memory access out of bounds") ||
      msg.includes("allocation failed") ||
      msg.includes("cannot allocate") ||
      (error instanceof RangeError && msg.includes("memory"))
    ) {
      return "oom";
    }

    if (
      msg.includes("wasm") ||
      msg.includes("enoent") ||
      msg.includes("instantiate")
    ) {
      return "internal";
    }
  }

  return "generic";
}

function sanitizeError(error: unknown): string {
  const type = classifyError(error);

  if (type === "oom") {
    return "Your device does not have enough memory to generate the zero-knowledge proof. Please try again on a device with more RAM, or use the server-side verification option.";
  }

  if (type === "internal") {
    return "Proof generation failed due to an internal error.";
  }

  return "Proof generation failed.";
}

import { getOptimizedZkpOptions } from "@/lib/zkp/wasmSimd";

/**
 * Generate a proof using explicit witness/prover lifecycle control with WebAssembly SIMD acceleration.
 *
 * snarkjs.fullProve() creates the witness internally and uses the default
 * multithreaded prover. For repeated browser-worker executions this can
 * retain WASM/worker resources longer than desired.
 *
 * We therefore:
 * 1. dynamically detect WebAssembly Fixed-width 128-bit SIMD vector support;
 * 2. create a memory-backed witness with SIMD-aligned buffer pages;
 * 3. pass SIMD acceleration flags to the Groth16 prover;
 * 4. release references after the proof completes;
 * 5. terminate the BN128 worker when snarkjs created one.
 */
async function generateProof(
  identityToken: string,
  expectedCommit: string,
): Promise<{
  proof: unknown;
  publicSignals: unknown;
  simdAccelerated: boolean;
}> {
  let wtns: { type: "mem" } | null = { type: "mem" };
  const zkpOptions = await getOptimizedZkpOptions();

  try {
    await (snarkjs as any).wtns.calculate(
      { identityToken, expectedCommit },
      "/zkp/premium_membership.wasm",
      wtns,
      zkpOptions.witnessOptions,
    );

    const proofResult = await (snarkjs.groth16 as any).prove(
      "/zkp/premium_membership.zkey",
      wtns,
      undefined,
      zkpOptions.proverOptions,
    );

    return {
      ...proofResult,
      simdAccelerated: zkpOptions.simdEnabled,
    };
  } finally {
    /*
     * Drop the witness reference as soon as the proof operation finishes.
     * This makes the WASM-backed witness eligible for garbage collection
     * instead of keeping it alive across consecutive requests.
     */
    wtns = null;

    const g = globalThis as typeof globalThis & {
      curve_bn128?: { terminate: () => Promise<void> };
    };

    if (g.curve_bn128) {
      try {
        await g.curve_bn128.terminate();
      } catch {
        // Cleanup must never mask the original proof result/error.
      }
    }
  }
}

self.addEventListener("message", async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === "cancel") {
    generation++;
    return;
  }

  if (e.data.type !== "prove") {
    return;
  }

  const myGeneration = ++generation;
  const { identityToken, expectedCommit } = e.data;

  if (typeof identityToken !== "string" || !/^-?\d+$/.test(identityToken)) {
    self.postMessage({
      type: "error",
      error: "Invalid identity token.",
    });
    return;
  }

  if (typeof expectedCommit !== "string" || !/^-?\d+$/.test(expectedCommit)) {
    self.postMessage({
      type: "error",
      error: "Invalid commitment value.",
    });
    return;
  }

  try {
    self.postMessage({
      type: "progress",
      stage: "generating",
    });

    const { proof, publicSignals, simdAccelerated } = await generateProof(
      identityToken,
      expectedCommit,
    );

    if (myGeneration !== generation) {
      return;
    }

    self.postMessage({
      type: "success",
      proof,
      publicSignals,
      simdAccelerated,
    });
  } catch (error) {
    if (myGeneration !== generation) {
      return;
    }

    const errorType = classifyError(error);

    self.postMessage({
      type: "error",
      error: sanitizeError(error),
      isOom: errorType === "oom",
    });
  }
});
