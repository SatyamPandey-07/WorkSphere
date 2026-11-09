import * as snarkjs from "snarkjs";

interface PremiumProofRequest {
  type: "prove";
  identityToken: string;
  expectedCommit: string;
}

interface StudentProofRequest {
  type: "prove-student" | "prove_student";
  secret: string;
  epoch: string | number;
  root: string;
  pathElements: string[];
  pathIndices: number[];
}

interface VerifyRequest {
  type: "verify" | "verify-student";
  proof: unknown;
  publicSignals: string[];
  circuit?: "student_membership" | "premium_membership";
}

interface CancelMessage {
  type: "cancel";
}

interface TerminateMessage {
  type: "terminate";
}

interface AbortMessage {
  type: "abort";
}

type WorkerMessage =
  | PremiumProofRequest
  | StudentProofRequest
  | VerifyRequest
  | CancelMessage
  | TerminateMessage
  | AbortMessage;

let generation = 0;

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
export const DEFAULT_PROVING_TIMEOUT_MS = 30_000;

// Setup unhandled rejection and uncaught exception listeners inside the worker
if (typeof self !== "undefined") {
  self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    event.preventDefault();
    const reason = event.reason;
    const errorType = classifyError(reason);
    self.postMessage({
      type: "error",
      error: sanitizeError(reason),
      code: errorType === "timeout" ? "PROVING_TIMEOUT" : "UNHANDLED_REJECTION",
      isTimeout: errorType === "timeout",
      details: reason instanceof Error ? reason.message : String(reason),
    });
  });

  self.addEventListener("error", (event: ErrorEvent) => {
    const errorType = classifyError(event.error || event.message);
    self.postMessage({
      type: "error",
      error: sanitizeError(event.error || event.message),
      code: errorType === "timeout" ? "PROVING_TIMEOUT" : "WORKER_ERROR",
      isTimeout: errorType === "timeout",
      details: event.message,
    });
  });
}

type WorkerErrorType = "oom" | "internal" | "timeout" | "generic";

export function classifyError(error: unknown): WorkerErrorType {
  if (error instanceof Error || (typeof error === "object" && error !== null)) {
    const errObj = error as any;
    const msg = String(errObj.message || errObj.name || error).toLowerCase();
    const isRangeError =
      error instanceof RangeError || errObj.name === "RangeError";

    if (
      msg.includes("verification_timeout") ||
      msg.includes("proving_timeout") ||
      msg.includes("witness generation timed out") ||
      msg.includes("timed out") ||
      msg.includes("timeout")
    ) {
      return "timeout";
    }

    if (
      msg.includes("out of memory") ||
      msg.includes("memory access out of bounds") ||
      msg.includes("allocation failed") ||
      msg.includes("cannot allocate") ||
      msg.includes("could not allocate memory") ||
      msg.includes("webassembly.memory") ||
      msg.includes("rangeerror") ||
      isRangeError
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

  if (type === "timeout") {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Witness generation timed out") || msg.includes("PROVING_TIMEOUT")) {
      return "Witness generation timed out after 30 seconds. Your device may not have enough processing power to generate cryptographic proofs.";
    }
    return "VERIFICATION_TIMEOUT";
  }

  if (type === "oom") {
    return "Your device does not have enough memory to generate the zero-knowledge proof. Please try again on a device with more RAM, or use the server-side verification option.";
  }

  if (type === "internal") {
    return "Proof generation failed due to an internal error.";
  }

  return "Proof generation failed.";
}

export function withTimeout<T>(
  promiseFn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_VERIFICATION_TIMEOUT_MS,
  timeoutErrorMessage = "VERIFICATION_TIMEOUT",
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutErrorMessage));
    }, timeoutMs);
  });

  return Promise.race([
    promiseFn(controller.signal),
    timeoutPromise,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

import { getOptimizedZkpOptions } from "@/lib/zkp/wasmSimd";

/**
 * Terminate the bn128 curve instance created by snarkjs on globalThis,
 * releasing thread pools, worker instances, and WASM memory.
 */
export async function terminateCurveBn128(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };

  if (g.curve_bn128) {
    try {
      await g.curve_bn128.terminate();
    } catch {
      // Cleanup must never mask results or throw
    } finally {
      delete g.curve_bn128;
    }
  }
}

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
    await terminateCurveBn128();
  }
}

self.addEventListener("message", async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === "cancel") {
    generation++;
    await terminateCurveBn128();
    return;
  }

  if (e.data.type === "abort" || e.data.type === "terminate") {
    generation++;
    await terminateCurveBn128();
    if (typeof self !== "undefined" && typeof self.close === "function") {
      self.close();
    }
    return;
  }

// ── Browser Verification in Web Worker (#3480) ───────────────────────────
  if (e.data.type === "verify" || e.data.type === "verify-student") {
    const { proof, publicSignals, circuit } = e.data;
    const timeoutMs = typeof (e.data as any).timeoutMs === "number" ? (e.data as any).timeoutMs : DEFAULT_VERIFICATION_TIMEOUT_MS;

    try {
      const isStudent = circuit === "student_membership" || e.data.type === "verify-student" || publicSignals.length >= 2;
      const vKeyUrl = isStudent
        ? "/zkp/student_membership_vkey.json"
        : "/zkp/verification_key.json";

      const resp = await fetch(vKeyUrl);
      const vKey = await resp.json();
      const isValid = await withTimeout(
        () => snarkjs.groth16.verify(vKey, publicSignals, proof as any),
        timeoutMs,
      );
      self.postMessage({ type: "verify_result", isValid });
    } catch (error) {
      const errorType = classifyError(error);
      self.postMessage({
        type: "error",
        error: sanitizeError(error),
        code: errorType === "timeout" ? "VERIFICATION_TIMEOUT" : undefined,
        isTimeout: errorType === "timeout",
      });
    } finally {
      await terminateCurveBn128();
    }
    return;
  }

  // ── Student Membership Groth16 Prover (#3480) ─────────────────────────────
  if (e.data.type === "prove-student" || e.data.type === "prove_student") {
    const myGeneration = ++generation;
    const { secret, epoch, root, pathElements, pathIndices } = e.data;
    const timeoutMs = typeof (e.data as any).timeoutMs === "number" ? (e.data as any).timeoutMs : DEFAULT_PROVING_TIMEOUT_MS;

    const hasSecret = typeof secret === "string" ? secret !== "" : secret != null;
    const hasEpoch =
      typeof epoch === "number" ? true : epoch != null && epoch !== "";
    const hasRoot = typeof root === "string" ? root !== "" : root != null;
    if (
      !hasSecret ||
      !hasEpoch ||
      !hasRoot ||
      !Array.isArray(pathElements) ||
      !Array.isArray(pathIndices)
    ) {
      self.postMessage({ type: "error", error: "Invalid student membership proof parameters." });
      return;
    }

    try {
      self.postMessage({ type: "progress", stage: "generating" });

      const { proof, publicSignals } = await withTimeout(
        () =>
          snarkjs.groth16.fullProve(
            {
              secret: String(secret),
              epoch: String(epoch),
              root: String(root),
              pathElements: pathElements.map(String),
              pathIndices: pathIndices.map(String),
            },
            "/zkp/student_membership.wasm",
            "/zkp/student_membership.zkey",
          ),
        timeoutMs,
        "Witness generation timed out after 30 seconds",
      );

      if (myGeneration !== generation) return;

      self.postMessage({ type: "success", proof, publicSignals });
    } catch (error) {
      if (myGeneration !== generation) return;
      const errorType = classifyError(error);
      self.postMessage({
        type: "error",
        error: sanitizeError(error),
        code: errorType === "timeout" ? "PROVING_TIMEOUT" : undefined,
        isOom: errorType === "oom",
        isTimeout: errorType === "timeout",
      });
    } finally {
      await terminateCurveBn128();
    }
    return;
  }

  // ── Premium Membership Prover (Optimized from main) ─────────────────────
  if (e.data.type === "prove") {
    const myGeneration = ++generation;
    const { identityToken, expectedCommit } = e.data;
    const timeoutMs = typeof (e.data as any).timeoutMs === "number" ? (e.data as any).timeoutMs : DEFAULT_PROVING_TIMEOUT_MS;

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

      // Using the memory-optimized generateProof instead of fullProve
      const { proof, publicSignals } = await withTimeout(
        () => generateProof(identityToken, expectedCommit),
        timeoutMs,
        "Witness generation timed out after 30 seconds",
      );

      if (myGeneration !== generation) {
        return;
      }

      self.postMessage({
        type: "success",
        proof,
        publicSignals,
      });
    } catch (error) {
      if (myGeneration !== generation) {
        return;
      }

      const errorType = classifyError(error);

      self.postMessage({
        type: "error",
        error: sanitizeError(error),
        code: errorType === "timeout" ? "PROVING_TIMEOUT" : undefined,
        isOom: errorType === "oom",
        isTimeout: errorType === "timeout",
      });
    } finally {
      await terminateCurveBn128();
    }
    return;
  }
});
