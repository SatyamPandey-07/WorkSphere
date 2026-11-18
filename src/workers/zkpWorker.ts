import * as snarkjs from "snarkjs";
import { getOptimizedZkpOptions } from "@/lib/zkp/wasmSimd";

interface PremiumProofRequest {
  type: "prove";
  identityToken: string;
  expectedCommit: string;
  maxProofsBeforeCycle?: number;
}

interface StudentProofRequest {
  type: "prove-student" | "prove_student";
  secret: string;
  epoch: string | number;
  root: string;
  pathElements: string[];
  pathIndices: number[];
  maxProofsBeforeCycle?: number;
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

interface CleanupMessage {
  type: "cleanup" | "cycle";
}

type WorkerMessage =
  | PremiumProofRequest
  | StudentProofRequest
  | VerifyRequest
  | CancelMessage
  | TerminateMessage
  | AbortMessage
  | CleanupMessage;

interface WitnessMemoryBuffer {
  type: "mem";
  data?: Uint8Array | null;
  [key: string]: unknown;
}

let generation = 0;
let consecutiveProofCount = 0;

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
export const DEFAULT_PROVING_TIMEOUT_MS = 30_000;
export const MAX_PROOFS_BEFORE_WORKER_CYCLE = 10;

function postWorkerMessage(payload: Record<string, unknown>): void {
  if (typeof self === "undefined" || typeof self.postMessage !== "function") {
    return;
  }
  try {
    (self.postMessage as (message: unknown) => void)(payload);
  } catch {
    // Ignore Window.postMessage targetOrigin errors in jsdom test environments
  }
}

// Setup unhandled rejection and uncaught exception listeners inside the worker
if (typeof self !== "undefined") {
  self.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason;
      const errorType = classifyError(reason);
      postWorkerMessage({
        type: "error",
        error: sanitizeError(reason),
        code:
          errorType === "timeout" ? "PROVING_TIMEOUT" : "UNHANDLED_REJECTION",
        isTimeout: errorType === "timeout",
        details: reason instanceof Error ? reason.message : String(reason),
      });
    },
  );

  self.addEventListener("error", (event: ErrorEvent) => {
    const errorType = classifyError(event.error || event.message);
    postWorkerMessage({
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
    if (
      msg.includes("Witness generation timed out") ||
      msg.includes("PROVING_TIMEOUT")
    ) {
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

  return Promise.race([promiseFn(controller.signal), timeoutPromise]).finally(
    () => {
      if (timer) clearTimeout(timer);
    },
  );
}

/**
 * Zero out and release any typed array buffers held inside an intermediate
 * witness object so V8 / WebAssembly linear memory views become immediately
 * eligible for garbage collection.
 */
export function releaseWitnessBuffer(
  wtns: WitnessMemoryBuffer | null | undefined,
): void {
  if (!wtns || typeof wtns !== "object") return;

  for (const key of Object.keys(wtns)) {
    const value = wtns[key];
    if (ArrayBuffer.isView(value)) {
      if (
        value instanceof Uint8Array ||
        value instanceof Int8Array ||
        value instanceof Uint8ClampedArray ||
        value instanceof Uint16Array ||
        value instanceof Int16Array ||
        value instanceof Uint32Array ||
        value instanceof Int32Array ||
        value instanceof Float32Array ||
        value instanceof Float64Array
      ) {
        value.fill(0);
      }
      wtns[key] = null;
    } else if (value instanceof ArrayBuffer) {
      new Uint8Array(value).fill(0);
      wtns[key] = null;
    }
  }
}

/**
 * Terminate the bn128 (and any auxiliary ffjavascript curve) instances created
 * by snarkjs on globalThis, releasing thread pools, sub-workers, and WASM memory.
 */
export async function terminateCurveBn128(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate?: () => Promise<void> };
    curve_bls12381?: { terminate?: () => Promise<void> };
    [key: string]: unknown;
  };

  const curveKeys = Object.keys(g).filter(
    (k) =>
      k === "curve_bn128" || k === "curve_bls12381" || k.startsWith("curve_"),
  );

  for (const key of curveKeys) {
    const curve = g[key] as { terminate?: () => Promise<void> } | undefined;
    if (curve && typeof curve.terminate === "function") {
      try {
        await curve.terminate();
      } catch {
        // Cleanup must never mask results or throw
      }
    }
    try {
      delete g[key];
    } catch {
      g[key] = undefined;
    }
  }
}

export function getConsecutiveProofCount(): number {
  return consecutiveProofCount;
}

export function resetConsecutiveProofCount(): void {
  consecutiveProofCount = 0;
}

/**
 * Cycle the worker after a batch of proof runs once curve memory and buffers
 * have been released, preventing long-lived WebAssembly heap fragmentation.
 */
export async function cycleWorkerIfNeeded(
  threshold: number = MAX_PROOFS_BEFORE_WORKER_CYCLE,
): Promise<boolean> {
  consecutiveProofCount += 1;
  if (threshold > 0 && consecutiveProofCount >= threshold) {
    const completed = consecutiveProofCount;
    consecutiveProofCount = 0;
    await terminateCurveBn128();
    postWorkerMessage({
      type: "worker_cycled",
      proofsCompleted: completed,
    });
    if (typeof self !== "undefined" && typeof self.close === "function") {
      try {
        self.close();
      } catch {
        // Ignore Window.close() restrictions in non-worker test environments
      }
    }
    return true;
  }
  return false;
}

/**
 * Execute Groth16 witness calculation + proving with explicit memory bounds
 * (`memorySize: 0`, `singleThread: true`), deterministic typed-array zeroing,
 * and BN128 curve termination.
 */
export async function executeBoundedGroth16Proof(
  circuitInputs: Record<string, unknown>,
  wasmUrl: string,
  zkeyUrl: string,
): Promise<{
  proof: unknown;
  publicSignals: unknown;
  simdAccelerated: boolean;
}> {
  let wtns: WitnessMemoryBuffer | null = { type: "mem" };
  const zkpOptions = await getOptimizedZkpOptions();

  const witnessOptions = {
    memorySize: 0,
    ...zkpOptions.witnessOptions,
  };
  const proverOptions = {
    singleThread: true,
    ...zkpOptions.proverOptions,
  };

  try {
    await snarkjs.wtns.calculate(
      circuitInputs as snarkjs.CircuitSignals,
      wasmUrl,
      wtns as unknown as snarkjs.WtnsFileName,
      witnessOptions as unknown as snarkjs.WtnsCalculateOptions,
    );

    const proofResult = await snarkjs.groth16.prove(
      zkeyUrl,
      wtns as unknown as snarkjs.WtnsFileName,
      undefined,
      proverOptions as unknown as snarkjs.Groth16ProveOptions,
    );

    return {
      ...proofResult,
      simdAccelerated: zkpOptions.simdEnabled,
    };
  } finally {
    releaseWitnessBuffer(wtns);
    wtns = null;
    await terminateCurveBn128();
  }
}

/**
 * Generate a premium membership proof using explicit witness/prover lifecycle
 * control with WebAssembly SIMD acceleration.
 */
async function generateProof(
  identityToken: string,
  expectedCommit: string,
): Promise<{
  proof: unknown;
  publicSignals: unknown;
  simdAccelerated: boolean;
}> {
  return executeBoundedGroth16Proof(
    { identityToken, expectedCommit },
    "/zkp/premium_membership.wasm",
    "/zkp/premium_membership.zkey",
  );
}

/**
 * Generate a student membership proof using explicit witness/prover lifecycle
 * control instead of monolithic snarkjs.groth16.fullProve so intermediate
 * witness Uint8Array buffers and BN128 curve instances are freed immediately.
 */
async function generateStudentProof(inputs: {
  secret: string;
  epoch: string | number;
  root: string;
  pathElements: string[];
  pathIndices: number[];
}): Promise<{
  proof: unknown;
  publicSignals: unknown;
  simdAccelerated: boolean;
}> {
  return executeBoundedGroth16Proof(
    {
      secret: String(inputs.secret),
      epoch: String(inputs.epoch),
      root: String(inputs.root),
      pathElements: inputs.pathElements.map(String),
      pathIndices: inputs.pathIndices.map(String),
    },
    "/zkp/student_membership.wasm",
    "/zkp/student_membership.zkey",
  );
}

if (typeof self !== "undefined") {
  self.addEventListener("message", async (e: MessageEvent<WorkerMessage>) => {
    if (e.data.type === "cancel") {
      generation++;
      await terminateCurveBn128();
      return;
    }

    if (e.data.type === "cleanup") {
      await terminateCurveBn128();
      return;
    }

    if (
      e.data.type === "abort" ||
      e.data.type === "terminate" ||
      e.data.type === "cycle"
    ) {
      generation++;
      resetConsecutiveProofCount();
      await terminateCurveBn128();
      if (typeof self !== "undefined" && typeof self.close === "function") {
        try {
          self.close();
        } catch {
          // Ignore Window.close() restrictions in test environments
        }
      }
      return;
    }

    // ── Browser Verification in Web Worker (#3480) ───────────────────────────
    if (e.data.type === "verify" || e.data.type === "verify-student") {
      const { proof, publicSignals, circuit } = e.data;
      const timeoutMs =
        typeof (e.data as any).timeoutMs === "number"
          ? (e.data as any).timeoutMs
          : DEFAULT_VERIFICATION_TIMEOUT_MS;

      try {
        const isStudent =
          circuit === "student_membership" ||
          e.data.type === "verify-student" ||
          publicSignals.length >= 2;
        const vKeyUrl = isStudent
          ? "/zkp/student_membership_vkey.json"
          : "/zkp/verification_key.json";

        const resp = await fetch(vKeyUrl);
        const vKey = await resp.json();
        const isValid = await withTimeout(
          () => snarkjs.groth16.verify(vKey, publicSignals, proof as any),
          timeoutMs,
        );
        postWorkerMessage({ type: "verify_result", isValid });
      } catch (error) {
        const errorType = classifyError(error);
        postWorkerMessage({
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
      const {
        secret,
        epoch,
        root,
        pathElements,
        pathIndices,
        maxProofsBeforeCycle,
      } = e.data;
      const timeoutMs =
        typeof (e.data as any).timeoutMs === "number"
          ? (e.data as any).timeoutMs
          : DEFAULT_PROVING_TIMEOUT_MS;

      const hasSecret =
        typeof secret === "string" ? secret !== "" : secret != null;
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
        postWorkerMessage({
          type: "error",
          error: "Invalid student membership proof parameters.",
        });
        return;
      }

      try {
        postWorkerMessage({ type: "progress", stage: "generating" });

        const { proof, publicSignals } = await withTimeout(
          () =>
            generateStudentProof({
              secret,
              epoch,
              root,
              pathElements,
              pathIndices,
            }),
          timeoutMs,
          "Witness generation timed out after 30 seconds",
        );

        if (myGeneration !== generation) return;

        postWorkerMessage({ type: "success", proof, publicSignals });
        await cycleWorkerIfNeeded(
          typeof maxProofsBeforeCycle === "number"
            ? maxProofsBeforeCycle
            : MAX_PROOFS_BEFORE_WORKER_CYCLE,
        );
      } catch (error) {
        if (myGeneration !== generation) return;
        const errorType = classifyError(error);
        postWorkerMessage({
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
      const { identityToken, expectedCommit, maxProofsBeforeCycle } = e.data;
      const timeoutMs =
        typeof (e.data as any).timeoutMs === "number"
          ? (e.data as any).timeoutMs
          : DEFAULT_PROVING_TIMEOUT_MS;

      if (typeof identityToken !== "string" || !/^-?\d+$/.test(identityToken)) {
        postWorkerMessage({
          type: "error",
          error: "Invalid identity token.",
        });
        return;
      }

      if (
        typeof expectedCommit !== "string" ||
        !/^-?\d+$/.test(expectedCommit)
      ) {
        postWorkerMessage({
          type: "error",
          error: "Invalid commitment value.",
        });
        return;
      }

      try {
        postWorkerMessage({
          type: "progress",
          stage: "generating",
        });

        const { proof, publicSignals } = await withTimeout(
          () => generateProof(identityToken, expectedCommit),
          timeoutMs,
          "Witness generation timed out after 30 seconds",
        );

        if (myGeneration !== generation) {
          return;
        }

        postWorkerMessage({
          type: "success",
          proof,
          publicSignals,
        });
        await cycleWorkerIfNeeded(
          typeof maxProofsBeforeCycle === "number"
            ? maxProofsBeforeCycle
            : MAX_PROOFS_BEFORE_WORKER_CYCLE,
        );
      } catch (error) {
        if (myGeneration !== generation) {
          return;
        }

        const errorType = classifyError(error);

        postWorkerMessage({
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
}
