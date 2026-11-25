/**
 * Dedicated Web Worker for Zero-Knowledge Proof generation using WebAssembly SnarkJS.
 *
 * Runs client-side Groth16 cryptographic proof synthesis off the main UI thread
 * to avoid frame drops, input latency, and UI freezes during intensive witness
 * computation and polynomial multiplication.
 *
 * Protocol:
 * Inbound:
 *   - GENERATE_PROOF: { type: "GENERATE_PROOF", inputs, wasmPath?, zkeyPath?, timeoutMs?, id? }
 *   - TERMINATE / CANCEL: { type: "TERMINATE" | "CANCEL", id? }
 * Outbound:
 *   - PROOF_PROGRESS: { type: "PROOF_PROGRESS", percent, stage, details?, id? }
 *   - PROOF_SUCCESS: { type: "PROOF_SUCCESS", proof, publicSignals, durationMs, id? }
 *   - PROOF_ERROR: { type: "PROOF_ERROR", error, code?, isTimeout?, isOom?, id? }
 */

import * as snarkjs from "snarkjs";

export const DEFAULT_WASM_PATH = "/zkp/student_membership.wasm";
export const DEFAULT_ZKEY_PATH = "/zkp/student_membership.zkey";
export const DEFAULT_PROVING_TIMEOUT_MS = 60_000;

export type ZkpProofWorkerErrorCode =
  "INVALID_INPUT" | "PROVING_TIMEOUT" | "OOM" | "ABORTED" | "WORKER_ERROR";

export type ZkpProofStage =
  | "initializing"
  | "witness"
  | "polynomial_multiplication"
  | "proving"
  | "complete";

export interface GenerateProofPayload {
  inputs?: Record<string, unknown>;
  secret?: string | number | bigint;
  epoch?: string | number | bigint;
  root?: string | number | bigint;
  pathElements?: Array<string | number | bigint>;
  pathIndices?: Array<string | number>;
  wasmPath?: string;
  zkeyPath?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

export type ZkpProofWorkerRequest =
  | {
      type: "GENERATE_PROOF";
      payload?: GenerateProofPayload;
      inputs?: Record<string, unknown>;
      secret?: string | number | bigint;
      epoch?: string | number | bigint;
      root?: string | number | bigint;
      pathElements?: Array<string | number | bigint>;
      pathIndices?: Array<string | number>;
      wasmPath?: string;
      zkeyPath?: string;
      timeoutMs?: number;
      id?: string;
    }
  | {
      type: "TERMINATE" | "CANCEL";
      id?: string;
    };

export interface ProofProgressMessage {
  type: "PROOF_PROGRESS";
  percent: number;
  stage: ZkpProofStage;
  details?: string;
  id?: string;
}

export interface ProofSuccessMessage {
  type: "PROOF_SUCCESS";
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
  durationMs: number;
  id?: string;
}

export interface ProofErrorMessage {
  type: "PROOF_ERROR";
  error: string;
  code?: ZkpProofWorkerErrorCode;
  isTimeout?: boolean;
  isOom?: boolean;
  details?: string;
  id?: string;
}

export type ZkpProofWorkerResponse =
  ProofProgressMessage | ProofSuccessMessage | ProofErrorMessage;

let generation = 0;

/**
 * Safely posts messages back to the host window / parent thread.
 */
export function defaultPost(message: ZkpProofWorkerResponse): void {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    try {
      self.postMessage(message);
    } catch {
      // Ignore Window.postMessage errors in headless/test environments
    }
  }
}

/**
 * Terminate curve_bn128 instance allocated by snarkjs on globalThis,
 * releasing thread pools, sub-workers, and WebAssembly memory buffers.
 */
export async function terminateCurveBn128(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (!g.curve_bn128) return;

  try {
    await g.curve_bn128.terminate();
  } catch {
    // Cleanup must never mask the main operation result
  } finally {
    delete g.curve_bn128;
  }
}

/**
 * Categorizes errors encountered during proof generation.
 */
export function classifyWorkerError(error: unknown): ZkpProofWorkerErrorCode {
  const message = (
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String((error as { message?: string })?.message ?? error)
  ).toLowerCase();

  if (message.includes("timeout") || message.includes("timed out")) {
    return "PROVING_TIMEOUT";
  }

  if (
    message.includes("out of memory") ||
    message.includes("memory access out of bounds") ||
    message.includes("allocation failed") ||
    message.includes("cannot allocate") ||
    message.includes("rangeerror") ||
    message.includes("heap limit")
  ) {
    return "OOM";
  }

  if (
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  ) {
    return "ABORTED";
  }

  if (
    message.includes("invalid input") ||
    message.includes("missing input") ||
    message.includes("unsupported") ||
    message.includes("invalid student")
  ) {
    return "INVALID_INPUT";
  }

  return "WORKER_ERROR";
}

/**
 * Recursively converts any BigInt values inside an object, array, or primitive into strings.
 */
export function serializeBigIntSignals(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigIntSignals);
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = serializeBigIntSignals(v);
  }
  return result;
}

/**
 * Normalizes input parameters for student membership / discount groth16 circuit.
 */
export function normalizeCircuitInputs(
  data: ZkpProofWorkerRequest,
): Record<string, unknown> {
  const payload =
    data.type === "GENERATE_PROOF"
      ? (data.payload ?? (data as GenerateProofPayload))
      : {};

  if (payload.inputs && typeof payload.inputs === "object") {
    return serializeBigIntSignals(payload.inputs) as Record<string, unknown>;
  }

  const inputs: Record<string, unknown> = {};

  if (payload.secret !== undefined) {
    inputs.secret = String(payload.secret);
  }
  if (payload.epoch !== undefined) {
    inputs.epoch = String(payload.epoch);
  }
  if (payload.root !== undefined) {
    inputs.root = String(payload.root);
  }
  if (
    payload.pathElements !== undefined &&
    Array.isArray(payload.pathElements)
  ) {
    inputs.pathElements = payload.pathElements.map(String);
  }
  if (payload.pathIndices !== undefined && Array.isArray(payload.pathIndices)) {
    inputs.pathIndices = payload.pathIndices.map(String);
  }

  // Copy any additional custom inputs
  for (const [k, v] of Object.entries(payload)) {
    if (
      ![
        "type",
        "payload",
        "inputs",
        "wasmPath",
        "zkeyPath",
        "timeoutMs",
        "id",
        "secret",
        "epoch",
        "root",
        "pathElements",
        "pathIndices",
      ].includes(k) &&
      v !== undefined
    ) {
      inputs[k] = serializeBigIntSignals(v);
    }
  }

  return inputs;
}

/**
 * Central message dispatcher for the Web Worker.
 */
export async function handleZkpProofWorkerMessage(
  data: ZkpProofWorkerRequest,
  post: (msg: ZkpProofWorkerResponse) => void = defaultPost,
): Promise<void> {
  if (!data || typeof data !== "object") return;

  const id = "id" in data ? data.id : undefined;

  // Handle termination / cancellation
  if (data.type === "TERMINATE" || data.type === "CANCEL") {
    generation++;
    await terminateCurveBn128();
    if (
      data.type === "TERMINATE" &&
      typeof self !== "undefined" &&
      typeof self.close === "function"
    ) {
      try {
        self.close();
      } catch {
        // Ignore Window.close restrictions in test environments
      }
    }
    return;
  }

  if (data.type !== "GENERATE_PROOF") {
    post({
      type: "PROOF_ERROR",
      error: `Unsupported worker message type: ${(data as any).type}`,
      code: "INVALID_INPUT",
      id,
    });
    return;
  }

  const currentGen = ++generation;
  const startTime = Date.now();

  const payload = (data.payload ?? (data as GenerateProofPayload)) || {};
  const wasmPath = payload.wasmPath || DEFAULT_WASM_PATH;
  const zkeyPath = payload.zkeyPath || DEFAULT_ZKEY_PATH;
  const timeoutMs =
    typeof payload.timeoutMs === "number"
      ? payload.timeoutMs
      : DEFAULT_PROVING_TIMEOUT_MS;

  const inputs = normalizeCircuitInputs(data);

  if (Object.keys(inputs).length === 0) {
    post({
      type: "PROOF_ERROR",
      error: "Missing circuit inputs for proof generation.",
      code: "INVALID_INPUT",
      id,
    });
    return;
  }

  // Set up execution timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Proof generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    // ── Phase 1: Initialization & Witness Computation ──────────────────────────
    post({
      type: "PROOF_PROGRESS",
      percent: 10,
      stage: "witness",
      details: "Initializing WebAssembly circuit and inputs",
      id,
    });

    if (currentGen !== generation) return;

    post({
      type: "PROOF_PROGRESS",
      percent: 30,
      stage: "witness",
      details: "Computing witness signals",
      id,
    });

    // ── Phase 2: Groth16 Prover & Polynomial Multiplication ────────────────────
    const progressLogger = {
      debug: (msg: unknown) => {
        if (currentGen !== generation) return;
        const text = String(msg);
        if (text.includes("Reading Wtns") || text.includes("Reading Coeffs")) {
          post({
            type: "PROOF_PROGRESS",
            percent: 50,
            stage: "witness",
            details: "Witness computed, loading proving key",
            id,
          });
        } else if (text.includes("Building ABC") || text.includes("Join ABC")) {
          post({
            type: "PROOF_PROGRESS",
            percent: 65,
            stage: "polynomial_multiplication",
            details: "Evaluating QAP constraints",
            id,
          });
        } else if (
          text.includes("Reading A Points") ||
          text.includes("Reading B1 Points") ||
          text.includes("Reading B2 Points") ||
          text.includes("Reading C Points") ||
          text.includes("Reading H Points")
        ) {
          post({
            type: "PROOF_PROGRESS",
            percent: 80,
            stage: "polynomial_multiplication",
            details: "Executing multi-scalar multiplication (MSM) on BN254",
            id,
          });
        } else if (text.includes("QAP") || text.includes("JoinABC")) {
          post({
            type: "PROOF_PROGRESS",
            percent: 90,
            stage: "polynomial_multiplication",
            details: "Finalizing polynomial division and quotient evaluation",
            id,
          });
        }
      },
      info: (msg: unknown) => {
        if (currentGen !== generation) return;
        const text = String(msg);
        if (text.includes("OK!")) {
          post({
            type: "PROOF_PROGRESS",
            percent: 95,
            stage: "proving",
            details: "Groth16 polynomial multiplication complete",
            id,
          });
        }
      },
      log: () => {},
      warn: () => {},
      error: () => {},
    };

    // Emit milestone progress before proving begins
    post({
      type: "PROOF_PROGRESS",
      percent: 45,
      stage: "polynomial_multiplication",
      details: "Starting polynomial multiplication and curve operations",
      id,
    });

    const proofExecution = (snarkjs.groth16.fullProve as any)(
      inputs,
      wasmPath,
      zkeyPath,
      progressLogger,
    );

    const result = await Promise.race([proofExecution, timeoutPromise]);

    if (currentGen !== generation) return;

    post({
      type: "PROOF_PROGRESS",
      percent: 100,
      stage: "complete",
      details: "Proof synthesis complete",
      id,
    });

    const durationMs = Date.now() - startTime;

    post({
      type: "PROOF_SUCCESS",
      proof: result.proof,
      publicSignals: result.publicSignals,
      durationMs,
      id,
    });
  } catch (error) {
    if (currentGen !== generation) return;

    const code = classifyWorkerError(error);
    const isTimeout = code === "PROVING_TIMEOUT";
    const isOom = code === "OOM";

    let errorMessage = "Zero-knowledge proof generation failed.";
    if (isTimeout) {
      errorMessage = `Proof generation timed out after ${timeoutMs}ms.`;
    } else if (isOom) {
      errorMessage =
        "Out of memory during Groth16 witness or polynomial computation.";
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    post({
      type: "PROOF_ERROR",
      error: errorMessage,
      code,
      isTimeout,
      isOom,
      details: error instanceof Error ? error.stack : String(error),
      id,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    await terminateCurveBn128();
  }
}

// ── Web Worker Global Listeners ─────────────────────────────────────────────
if (
  typeof self !== "undefined" &&
  typeof self.addEventListener === "function"
) {
  self.addEventListener(
    "message",
    (event: MessageEvent<ZkpProofWorkerRequest>) => {
      void handleZkpProofWorkerMessage(event.data);
    },
  );

  self.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason = event.reason;
      const code = classifyWorkerError(reason);
      defaultPost({
        type: "PROOF_ERROR",
        error: reason instanceof Error ? reason.message : String(reason),
        code,
        isTimeout: code === "PROVING_TIMEOUT",
        isOom: code === "OOM",
      });
      void terminateCurveBn128();
    },
  );

  self.addEventListener("error", (event: ErrorEvent) => {
    const code = classifyWorkerError(event.error || event.message);
    defaultPost({
      type: "PROOF_ERROR",
      error: event.message || "Uncaught worker error",
      code,
      isTimeout: code === "PROVING_TIMEOUT",
      isOom: code === "OOM",
    });
    void terminateCurveBn128();
  });
}
