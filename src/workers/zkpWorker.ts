import * as snarkjs from "snarkjs";
import { getOptimizedZkpOptions } from "@/lib/zkp/wasmSimd";

// ── TypeScript Message Protocol Types ──────────────────────────────────────

export interface GenerateProofRequest {
  type: "GENERATE_PROOF";
  studentHash?: string;
  epochSalt?: string | number;
  nullifierSecret?: string;
  // Backward compatibility / optional fields
  secret?: string;
  epoch?: string | number;
  root?: string;
  pathElements?: string[];
  pathIndices?: number[];
  circuit?: "student_pass" | "student_membership" | "student_access_pass";
  wasmUrl?: string;
  zkeyUrl?: string;
  maxProofsBeforeCycle?: number;
  timeoutMs?: number;
}

export interface PremiumProofRequest {
  type: "prove";
  identityToken: string;
  expectedCommit: string;
  maxProofsBeforeCycle?: number;
}

export interface StudentProofRequest {
  type: "prove-student" | "prove_student";
  secret: string;
  epoch: string | number;
  root: string;
  pathElements: string[];
  pathIndices: number[];
  maxProofsBeforeCycle?: number;
}

export interface VerifyRequest {
  type: "verify" | "verify-student";
  proof: unknown;
  publicSignals: string[];
  circuit?: "student_membership" | "premium_membership" | "student_pass";
  timeoutMs?: number;
}

export interface CancelMessage {
  type: "cancel";
}

export interface TerminateMessage {
  type: "terminate";
}

export interface AbortMessage {
  type: "abort";
}

export interface CleanupMessage {
  type: "cleanup" | "cycle";
}

export type WorkerRequest =
  | GenerateProofRequest
  | PremiumProofRequest
  | StudentProofRequest
  | VerifyRequest
  | CancelMessage
  | TerminateMessage
  | AbortMessage
  | CleanupMessage;

export type WorkerProgressStep =
  | "INITIALIZING"
  | "LOADING_ARTIFACTS"
  | "WITNESS_GENERATION"
  | "PROOF_SYNTHESIS"
  | "FINALIZING"
  | "witness"
  | "proving";

export interface WorkerProgressResponse {
  type: "PROGRESS" | "progress";
  step: WorkerProgressStep;
  progress: number; // 0.0 - 1.0 (monotonic stage-based)
  percent?: number; // 0 - 100 for legacy compatibility
  stage?: string;
  message?: string;
}

export interface WorkerSuccessResponse {
  type: "SUCCESS" | "success";
  proof: unknown;
  publicSignals: string[];
  simdAccelerated?: boolean;
}

export interface WorkerErrorResponse {
  type: "ERROR" | "error";
  error: string;
  code?: string;
  isOom?: boolean;
  isTimeout?: boolean;
  details?: string;
}

export interface WorkerVerifyResponse {
  type: "verify_result";
  isValid: boolean;
}

export interface WorkerCycledResponse {
  type: "worker_cycled";
  proofsCompleted: number;
}

export type WorkerResponse =
  | WorkerProgressResponse
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerVerifyResponse
  | WorkerCycledResponse;

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

export type WorkerErrorType = "oom" | "internal" | "timeout" | "generic";

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
      msg.includes("instantiate") ||
      msg.includes("not found") ||
      msg.includes("artifact")
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
 * Resolve circuit artifact paths safely across worker environments.
 */
export function resolveArtifactUrls(
  requestedWasmUrl?: string,
  requestedZkeyUrl?: string,
): {
  wasmUrl: string;
  zkeyUrl: string;
} {
  const defaultWasm = "/zkp/student_membership.wasm";
  const defaultZkey = "/zkp/student_membership.zkey";

  return {
    wasmUrl: requestedWasmUrl || defaultWasm,
    zkeyUrl: requestedZkeyUrl || defaultZkey,
  };
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
  onProgressStep?: (step: WorkerProgressStep, progress: number) => void,
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
    onProgressStep?.("WITNESS_GENERATION", 0.5);

    await snarkjs.wtns.calculate(
      circuitInputs as snarkjs.CircuitSignals,
      wasmUrl,
      wtns as unknown as snarkjs.WtnsFileName,
      witnessOptions as unknown as snarkjs.WtnsCalculateOptions,
    );

    onProgressStep?.("PROOF_SYNTHESIS", 0.8);

    const proofResult = await snarkjs.groth16.prove(
      zkeyUrl,
      wtns as unknown as snarkjs.WtnsFileName,
      undefined,
      proverOptions as unknown as snarkjs.Groth16ProveOptions,
    );

    onProgressStep?.("FINALIZING", 1.0);

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
 * Generate a student membership proof using explicit witness/prover lifecycle.
 */
async function generateStudentProof(
  inputs: {
    secret: string;
    epoch: string | number;
    root: string;
    pathElements: string[];
    pathIndices: number[];
  },
  wasmUrl: string = "/zkp/student_membership.wasm",
  zkeyUrl: string = "/zkp/student_membership.zkey",
  onProgressStep?: (step: WorkerProgressStep, progress: number) => void,
): Promise<{
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
    wasmUrl,
    zkeyUrl,
    onProgressStep,
  );
}

/**
 * Main message handler for incoming worker requests.
 * Exported to allow direct, mockable unit testing without worker thread spawning.
 */
export async function handleZkpWorkerMessage(
  data: WorkerRequest,
  postFn: (msg: Record<string, unknown>) => void = postWorkerMessage,
): Promise<void> {
  if (!data || typeof data !== "object") {
    postFn({
      type: "ERROR",
      error: "Invalid worker message format",
      code: "INVALID_REQUEST",
    });
    return;
  }

  if (data.type === "cancel") {
    generation++;
    await terminateCurveBn128();
    return;
  }

  if (data.type === "cleanup") {
    await terminateCurveBn128();
    return;
  }

  if (
    data.type === "abort" ||
    data.type === "terminate" ||
    data.type === "cycle"
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

  // ── Protocol: GENERATE_PROOF (Issue #9356) ──────────────────────────────
  if (data.type === "GENERATE_PROOF") {
    const myGeneration = ++generation;
    const {
      studentHash,
      epochSalt,
      nullifierSecret,
      secret,
      epoch,
      root,
      pathElements,
      pathIndices,
      wasmUrl: customWasm,
      zkeyUrl: customZkey,
      maxProofsBeforeCycle,
    } = data;

    const timeoutMs =
      typeof data.timeoutMs === "number"
        ? data.timeoutMs
        : DEFAULT_PROVING_TIMEOUT_MS;

    // Validate inputs - studentHash/epochSalt/nullifierSecret or legacy secret/epoch/root
    const effectiveSecret = secret ?? nullifierSecret ?? studentHash;
    const effectiveEpoch = epoch ?? epochSalt ?? "2026";
    const effectiveRoot =
      root ??
      "1849102948102938401928401928401928401928401928401928401928401928";
    const effectivePathElements = Array.isArray(pathElements)
      ? pathElements
      : Array(16).fill("0");
    const effectivePathIndices = Array.isArray(pathIndices)
      ? pathIndices
      : Array(16).fill(0);

    const hasSecret =
      typeof effectiveSecret === "string"
        ? effectiveSecret.trim() !== ""
        : effectiveSecret != null;
    const hasEpoch =
      typeof effectiveEpoch === "number"
        ? true
        : effectiveEpoch != null && String(effectiveEpoch).trim() !== "";

    if (!hasSecret || !hasEpoch) {
      postFn({
        type: "ERROR",
        error: "Missing or malformed proof generation inputs.",
        code: "INVALID_INPUTS",
      });
      return;
    }

    const { wasmUrl, zkeyUrl } = resolveArtifactUrls(customWasm, customZkey);

    try {
      postFn({
        type: "PROGRESS",
        step: "INITIALIZING",
        progress: 0.1,
        percent: 10,
        stage: "INITIALIZING",
        message: "Initializing proof synthesis runtime...",
      });

      postFn({
        type: "PROGRESS",
        step: "LOADING_ARTIFACTS",
        progress: 0.25,
        percent: 25,
        stage: "LOADING_ARTIFACTS",
        message: "Loading cryptographic proving artifacts...",
      });

      const { proof, publicSignals, simdAccelerated } = await withTimeout(
        () =>
          generateStudentProof(
            {
              secret: String(effectiveSecret),
              epoch: String(effectiveEpoch),
              root: String(effectiveRoot),
              pathElements: effectivePathElements.map(String),
              pathIndices: effectivePathIndices.map(Number),
            },
            wasmUrl,
            zkeyUrl,
            (step, progress) => {
              if (myGeneration !== generation) return;
              postFn({
                type: "PROGRESS",
                step,
                progress,
                percent: Math.round(progress * 100),
                stage: step,
                message:
                  step === "WITNESS_GENERATION"
                    ? "Generating cryptographic witness..."
                    : step === "PROOF_SYNTHESIS"
                      ? "Synthesizing Groth16 zero-knowledge proof..."
                      : "Finalizing proof...",
              });
            },
          ),
        timeoutMs,
        "Witness generation timed out after 30 seconds",
      );

      if (myGeneration !== generation) return;

      postFn({
        type: "SUCCESS",
        proof,
        publicSignals: publicSignals as string[],
        simdAccelerated,
      });

      await cycleWorkerIfNeeded(
        typeof maxProofsBeforeCycle === "number"
          ? maxProofsBeforeCycle
          : MAX_PROOFS_BEFORE_WORKER_CYCLE,
      );
    } catch (error) {
      if (myGeneration !== generation) return;
      const errorType = classifyError(error);
      postFn({
        type: "ERROR",
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

  // ── Browser Verification in Web Worker ───────────────────────────────────
  if (data.type === "verify" || data.type === "verify-student") {
    const { proof, publicSignals, circuit } = data;
    const timeoutMs =
      typeof data.timeoutMs === "number"
        ? data.timeoutMs
        : DEFAULT_VERIFICATION_TIMEOUT_MS;

    try {
      const isStudent =
        circuit === "student_membership" ||
        circuit === "student_pass" ||
        data.type === "verify-student" ||
        (Array.isArray(publicSignals) && publicSignals.length >= 2);
      const vKeyUrl = isStudent
        ? "/zkp/student_membership_vkey.json"
        : "/zkp/verification_key.json";

      const resp = await fetch(vKeyUrl);
      const vKey = await resp.json();
      const isValid = await withTimeout(
        () => snarkjs.groth16.verify(vKey, publicSignals, proof as any),
        timeoutMs,
      );
      postFn({ type: "verify_result", isValid });
    } catch (error) {
      const errorType = classifyError(error);
      postFn({
        type: "ERROR",
        error: sanitizeError(error),
        code: errorType === "timeout" ? "VERIFICATION_TIMEOUT" : undefined,
        isTimeout: errorType === "timeout",
      });
    } finally {
      await terminateCurveBn128();
    }
    return;
  }

  // ── Student Membership Groth16 Prover (Legacy/Compatibility) ─────────────
  if (data.type === "prove-student" || data.type === "prove_student") {
    const myGeneration = ++generation;
    const {
      secret,
      epoch,
      root,
      pathElements,
      pathIndices,
      maxProofsBeforeCycle,
    } = data;
    const timeoutMs =
      typeof (data as any).timeoutMs === "number"
        ? (data as any).timeoutMs
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
      postFn({
        type: "error",
        error: "Invalid student membership proof parameters.",
      });
      return;
    }

    try {
      postFn({ type: "progress", stage: "generating", percent: 25 });

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

      postFn({ type: "success", proof, publicSignals });
      await cycleWorkerIfNeeded(
        typeof maxProofsBeforeCycle === "number"
          ? maxProofsBeforeCycle
          : MAX_PROOFS_BEFORE_WORKER_CYCLE,
      );
    } catch (error) {
      if (myGeneration !== generation) return;
      const errorType = classifyError(error);
      postFn({
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

  // ── Premium Membership Prover ─────────────────────────────────────────────
  if (data.type === "prove") {
    const myGeneration = ++generation;
    const { identityToken, expectedCommit, maxProofsBeforeCycle } = data;
    const timeoutMs =
      typeof (data as any).timeoutMs === "number"
        ? (data as any).timeoutMs
        : DEFAULT_PROVING_TIMEOUT_MS;

    if (typeof identityToken !== "string" || !/^-?\d+$/.test(identityToken)) {
      postFn({
        type: "error",
        error: "Invalid identity token.",
      });
      return;
    }

    if (typeof expectedCommit !== "string" || !/^-?\d+$/.test(expectedCommit)) {
      postFn({
        type: "error",
        error: "Invalid commitment value.",
      });
      return;
    }

    try {
      postFn({
        type: "progress",
        stage: "generating",
        percent: 25,
      });

      const { proof, publicSignals } = await withTimeout(
        () => generateProof(identityToken, expectedCommit),
        timeoutMs,
        "Witness generation timed out after 30 seconds",
      );

      if (myGeneration !== generation) {
        return;
      }

      postFn({
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

      postFn({
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
}

// Setup unhandled rejection and uncaught exception listeners inside the worker
function isWorkerGlobalScope(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).WorkerGlobalScope !== "undefined" &&
    typeof (globalThis as any).addEventListener === "function"
  );
}

if (isWorkerGlobalScope()) {
  self.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason;
      const errorType = classifyError(reason);
      postWorkerMessage({
        type: "ERROR",
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
      type: "ERROR",
      error: sanitizeError(event.error || event.message),
      code: errorType === "timeout" ? "PROVING_TIMEOUT" : "WORKER_ERROR",
      isTimeout: errorType === "timeout",
      details: event.message,
    });
  });

  self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
    await handleZkpWorkerMessage(e.data, postWorkerMessage);
  });
}
