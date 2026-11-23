/**
 * Student Discount Zero-Knowledge Proof Verifier and Worker Orchestrator.
 *
 * Coordinates client-side Groth16 proof synthesis inside a dedicated Web Worker
 * (src/workers/zkpProofWorker.ts) using WebAssembly SnarkJS.
 *
 * Guarantees:
 * 1. Off-thread execution: Proof computation runs inside a dedicated Web Worker
 *    to prevent main-thread UI freezes and frame drops.
 * 2. Progress reporting: Real-time progress percentages emitted during witness
 *    computation (0-50%) and polynomial multiplication / MSM (50-100%).
 * 3. Graceful fallback: Environments where Web Workers are disabled (e.g. SSR,
 *    restricted browser sandboxes, or headless tests) fall back to in-process
 *    SnarkJS proving without throwing.
 * 4. Cache integration: Reuses valid proofs from IndexedDB via src/lib/zkp/proofCache.ts.
 * 5. Clean termination: Closes worker instances and frees curve_bn128 memory.
 */

import * as snarkjs from "snarkjs";
import {
  getCachedProof,
  storeProof,
  invalidateProof,
  STUDENT_DISCOUNT_SCOPE,
} from "@/lib/zkp/proofCache";
import {
  DEFAULT_WASM_PATH,
  DEFAULT_ZKEY_PATH,
  DEFAULT_PROVING_TIMEOUT_MS,
  terminateCurveBn128,
  type ZkpProofStage,
  type ZkpProofWorkerResponse,
  type ZkpProofWorkerRequest,
} from "@/workers/zkpProofWorker";
import { computeStudentLeaf } from "@/lib/zkp/studentMembership";

export { STUDENT_DISCOUNT_SCOPE };

export const DEFAULT_STUDENT_VKEY_PATH = "/zkp/student_membership_vkey.json";
export const FALLBACK_VKEY_PATH = "/zkp/verification_key.json";

export interface StudentDiscountProofInput {
  secret: string | number | bigint;
  epoch?: string | number | bigint;
  root?: string | number | bigint;
  pathElements?: Array<string | number | bigint>;
  pathIndices?: Array<string | number>;
  expectedCommit?: string;
  [key: string]: unknown;
}

export interface StudentDiscountProgressEvent {
  stage: ZkpProofStage | "cache";
  percent: number;
  details?: string;
}

export type StudentDiscountProgressCallback = (
  progress: StudentDiscountProgressEvent,
) => void;

export interface StudentDiscountVerifierOptions {
  wasmPath?: string;
  zkeyPath?: string;
  vkeyPath?: string;
  timeoutMs?: number;
  useCache?: boolean;
  scope?: string;
  forceFallback?: boolean;
  createWorker?: () => Worker;
  onProgress?: StudentDiscountProgressCallback;
  signal?: AbortSignal;
}

export interface StudentDiscountProofResult {
  proof: unknown;
  publicSignals: string[];
  durationMs: number;
  proofSource: "worker" | "fallback" | "cache";
}

export interface StudentDiscountVerifyResult {
  isValid: boolean;
  discountEligible: boolean;
  error?: string;
  details?: unknown;
}

/**
 * Returns true if Web Workers are supported and enabled in the current environment.
 */
export function isWebWorkerSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/**
 * Instantiates the dedicated ZKP Proof Web Worker.
 */
export function createZkpProofWorker(): Worker {
  if (!isWebWorkerSupported()) {
    throw new Error(
      "Web Workers are not supported in this runtime environment.",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createZkpProofWorker: factory } = require("./createZkpProofWorker");
  return factory();
}

/**
 * Formats input values into string representations required by snarkjs signals.
 */
function normalizeInputs(
  inputs: StudentDiscountProofInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    secret: String(inputs.secret),
    epoch: String(inputs.epoch ?? 2026),
  };

  if (inputs.root !== undefined) {
    result.root = String(inputs.root);
  }
  if (inputs.pathElements && Array.isArray(inputs.pathElements)) {
    result.pathElements = inputs.pathElements.map(String);
  }
  if (inputs.pathIndices && Array.isArray(inputs.pathIndices)) {
    result.pathIndices = inputs.pathIndices.map(String);
  }

  for (const [k, v] of Object.entries(inputs)) {
    if (
      ![
        "secret",
        "epoch",
        "root",
        "pathElements",
        "pathIndices",
        "expectedCommit",
      ].includes(k) &&
      v !== undefined
    ) {
      result[k] = typeof v === "bigint" ? v.toString() : v;
    }
  }

  return result;
}

/**
 * Derives a candidate cache key / commitment for client-side proof caching.
 */
function deriveCommitmentKey(inputs: StudentDiscountProofInput): string {
  if (inputs.expectedCommit) {
    return String(inputs.expectedCommit);
  }
  if (inputs.root) {
    return String(inputs.root);
  }
  try {
    const epoch = inputs.epoch ?? 2026;
    return computeStudentLeaf(inputs.secret, epoch).toString();
  } catch {
    return String(inputs.secret);
  }
}

/**
 * Fallback proof synthesizer when Web Workers are disabled or unavailable.
 * Executes on the local thread with simulated/real progress checkpoints.
 */
export async function generateStudentProofFallback(
  inputs: StudentDiscountProofInput,
  options: StudentDiscountVerifierOptions = {},
): Promise<StudentDiscountProofResult> {
  const startTime = Date.now();
  const onProgress = options.onProgress;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVING_TIMEOUT_MS;
  const wasmPath = options.wasmPath ?? DEFAULT_WASM_PATH;
  const zkeyPath = options.zkeyPath ?? DEFAULT_ZKEY_PATH;

  if (options.signal?.aborted) {
    throw new Error("Proof generation aborted.");
  }

  onProgress?.({
    stage: "initializing",
    percent: 5,
    details: "Initializing fallback Groth16 prover",
  });

  const formattedInputs = normalizeInputs(inputs);

  onProgress?.({
    stage: "witness",
    percent: 25,
    details: "Computing circuit witness (fallback)",
  });

  const progressLogger = {
    debug: (msg: unknown) => {
      const text = String(msg);
      if (text.includes("Reading Wtns")) {
        onProgress?.({
          stage: "witness",
          percent: 50,
          details: "Witness computed, preparing proving keys",
        });
      } else if (text.includes("Building ABC") || text.includes("Join ABC")) {
        onProgress?.({
          stage: "polynomial_multiplication",
          percent: 65,
          details: "Evaluating QAP constraints",
        });
      } else if (text.includes("Points")) {
        onProgress?.({
          stage: "polynomial_multiplication",
          percent: 80,
          details: "Executing multi-scalar multiplication (fallback)",
        });
      }
    },
    info: (msg: unknown) => {
      if (String(msg).includes("OK!")) {
        onProgress?.({
          stage: "proving",
          percent: 95,
          details: "Finalizing Groth16 proof polynomial",
        });
      }
    },
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  onProgress?.({
    stage: "polynomial_multiplication",
    percent: 55,
    details: "Performing polynomial multiplication",
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Proof generation timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    const proverPromise = (snarkjs.groth16.fullProve as any)(
      formattedInputs,
      wasmPath,
      zkeyPath,
      progressLogger,
    );

    const { proof, publicSignals } = await Promise.race([
      proverPromise,
      timeoutPromise,
    ]);

    onProgress?.({
      stage: "complete",
      percent: 100,
      details: "Proof synthesis complete",
    });

    return {
      proof,
      publicSignals,
      durationMs: Date.now() - startTime,
      proofSource: "fallback",
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await terminateCurveBn128();
  }
}

/**
 * Generates student proof inside a dedicated Web Worker with progress updates.
 */
export async function generateStudentProofWithWorker(
  inputs: StudentDiscountProofInput,
  options: StudentDiscountVerifierOptions = {},
  workerInstance?: Worker,
): Promise<StudentDiscountProofResult> {
  const startTime = Date.now();
  const onProgress = options.onProgress;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVING_TIMEOUT_MS;
  const wasmPath = options.wasmPath ?? DEFAULT_WASM_PATH;
  const zkeyPath = options.zkeyPath ?? DEFAULT_ZKEY_PATH;

  if (options.signal?.aborted) {
    throw new Error("Proof generation aborted.");
  }

  const worker =
    workerInstance ??
    (options.createWorker ? options.createWorker() : createZkpProofWorker());

  return new Promise<StudentDiscountProofResult>((resolve, reject) => {
    let completed = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      completed = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (!workerInstance) {
        try {
          worker.postMessage({ type: "TERMINATE" });
        } catch {
          // ignore
        }
        try {
          worker.terminate();
        } catch {
          // ignore
        }
      }
    };

    const onAbort = () => {
      if (completed) return;
      try {
        worker.postMessage({ type: "CANCEL" });
      } catch {
        // ignore
      }
      cleanup();
      reject(new Error("Proof generation aborted."));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutTimer = setTimeout(() => {
      if (completed) return;
      try {
        worker.postMessage({ type: "CANCEL" });
      } catch {
        // ignore
      }
      cleanup();
      reject(new Error(`Proof generation timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent<ZkpProofWorkerResponse>) => {
      if (completed) return;
      const data = event.data;

      if (!data || typeof data !== "object") return;

      if (data.type === "PROOF_PROGRESS") {
        onProgress?.({
          stage: data.stage,
          percent: data.percent,
          details: data.details,
        });
      } else if (data.type === "PROOF_SUCCESS") {
        cleanup();
        resolve({
          proof: data.proof,
          publicSignals: data.publicSignals,
          durationMs: data.durationMs || Date.now() - startTime,
          proofSource: "worker",
        });
      } else if (data.type === "PROOF_ERROR") {
        cleanup();
        const err = new Error(data.error);
        (err as any).code = data.code;
        (err as any).isTimeout = data.isTimeout;
        (err as any).isOom = data.isOom;
        reject(err);
      }
    };

    const onError = (event: ErrorEvent) => {
      if (completed) return;
      cleanup();
      reject(
        new Error(
          event.message || "Web Worker encountered an unexpected error.",
        ),
      );
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const request: ZkpProofWorkerRequest = {
      type: "GENERATE_PROOF",
      payload: {
        inputs: normalizeInputs(inputs),
        wasmPath,
        zkeyPath,
        timeoutMs,
      },
    };

    worker.postMessage(request);
  });
}

/**
 * High-level function to synthesize a zero-knowledge student proof.
 * Checks IndexedDB cache first, delegates to dedicated Web Worker when available,
 * and falls back to in-thread execution when workers are disabled or unsupported.
 */
export async function generateStudentDiscountProof(
  inputs: StudentDiscountProofInput,
  options: StudentDiscountVerifierOptions = {},
): Promise<StudentDiscountProofResult> {
  const scope = options.scope ?? STUDENT_DISCOUNT_SCOPE;
  const useCache = options.useCache !== false;
  const commitKey = deriveCommitmentKey(inputs);

  // 1. Check IndexedDB proof cache
  if (useCache && commitKey) {
    try {
      const cached = await getCachedProof(scope, commitKey);
      if (cached && Array.isArray(cached.publicSignals)) {
        options.onProgress?.({
          stage: "cache",
          percent: 100,
          details: "Served from IndexedDB proof cache",
        });
        return {
          proof: cached.proof,
          publicSignals: cached.publicSignals,
          durationMs: 0,
          proofSource: "cache",
        };
      }
    } catch {
      // IndexedDB unavailable or blocked; proceed with fresh proving
    }
  }

  // 2. Decide worker vs fallback
  const canUseWorker =
    !options.forceFallback &&
    (options.createWorker !== undefined || isWebWorkerSupported());

  let result: StudentDiscountProofResult;

  if (canUseWorker) {
    try {
      result = await generateStudentProofWithWorker(inputs, options);
    } catch (err) {
      // If worker creation failed due to security/sandboxing restrictions, try fallback
      const isWorkerInitFailure =
        err instanceof Error &&
        (err.message.includes("Worker is not defined") ||
          err.message.includes("SecurityError") ||
          err.message.includes("not supported"));

      if (isWorkerInitFailure) {
        result = await generateStudentProofFallback(inputs, options);
      } else {
        throw err;
      }
    }
  } else {
    result = await generateStudentProofFallback(inputs, options);
  }

  // 3. Store in proof cache on success
  if (useCache && result.publicSignals?.[0]) {
    try {
      const storageCommit = result.publicSignals[0];
      await storeProof(scope, storageCommit, {
        proof: result.proof,
        publicSignals: result.publicSignals,
      });
    } catch {
      // Caching is best-effort
    }
  }

  return result;
}

/**
 * Verifies a Groth16 student discount proof against the verification key.
 */
export async function verifyStudentDiscountProof(
  proof: unknown,
  publicSignals: string[],
  vKeyOrUrl: unknown = DEFAULT_STUDENT_VKEY_PATH,
): Promise<StudentDiscountVerifyResult> {
  if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
    return {
      isValid: false,
      discountEligible: false,
      error: "Missing proof or public signals for verification.",
    };
  }

  let vKey: unknown = vKeyOrUrl;

  try {
    if (typeof vKeyOrUrl === "string") {
      // Browser fetch
      if (typeof fetch === "function") {
        let resp = await fetch(vKeyOrUrl);
        if (!resp.ok && vKeyOrUrl !== FALLBACK_VKEY_PATH) {
          resp = await fetch(FALLBACK_VKEY_PATH);
        }
        if (!resp.ok) {
          throw new Error(`Failed to load verification key from ${vKeyOrUrl}`);
        }
        vKey = await resp.json();
      } else if (typeof require !== "undefined") {
        // Node / Server environment
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path");
        const resolvedPath = path.isAbsolute(vKeyOrUrl)
          ? vKeyOrUrl
          : path.join(process.cwd(), "public", vKeyOrUrl.replace(/^\//, ""));

        if (fs.existsSync(resolvedPath)) {
          vKey = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
        } else {
          const fallbackPath = path.join(
            process.cwd(),
            "public",
            "zkp",
            "verification_key.json",
          );
          vKey = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
        }
      }
    }

    const isValid = await snarkjs.groth16.verify(
      vKey,
      publicSignals,
      proof as any,
    );

    return {
      isValid,
      discountEligible: isValid,
    };
  } catch (err) {
    return {
      isValid: false,
      discountEligible: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  } finally {
    await terminateCurveBn128();
  }
}

/**
 * StudentDiscountVerifier orchestrator class for managing proof generation,
 * worker reuse, and verification lifecycle.
 */
export class StudentDiscountVerifier {
  private worker: Worker | null = null;
  private options: StudentDiscountVerifierOptions;

  constructor(options: StudentDiscountVerifierOptions = {}) {
    this.options = { ...options };
  }

  public isWorkerAvailable(): boolean {
    return (
      !this.options.forceFallback &&
      (this.options.createWorker !== undefined || isWebWorkerSupported())
    );
  }

  private getOrSpawnWorker(): Worker {
    if (!this.worker) {
      this.worker = this.options.createWorker
        ? this.options.createWorker()
        : createZkpProofWorker();
    }
    return this.worker;
  }

  public async generateProof(
    inputs: StudentDiscountProofInput,
    overrideOptions?: Partial<StudentDiscountVerifierOptions>,
  ): Promise<StudentDiscountProofResult> {
    const mergedOptions: StudentDiscountVerifierOptions = {
      ...this.options,
      ...overrideOptions,
    };

    const canUseWorker =
      !mergedOptions.forceFallback &&
      (mergedOptions.createWorker !== undefined || isWebWorkerSupported());

    if (!canUseWorker) {
      return generateStudentDiscountProof(inputs, {
        ...mergedOptions,
        forceFallback: true,
      });
    }

    const worker = this.getOrSpawnWorker();
    return generateStudentProofWithWorker(inputs, mergedOptions, worker);
  }

  public async verifyProof(
    proof: unknown,
    publicSignals: string[],
    vKeyOrUrl?: unknown,
  ): Promise<StudentDiscountVerifyResult> {
    const key = vKeyOrUrl ?? this.options.vkeyPath ?? DEFAULT_STUDENT_VKEY_PATH;
    return verifyStudentDiscountProof(proof, publicSignals, key);
  }

  public async invalidateCache(commit: string): Promise<void> {
    const scope = this.options.scope ?? STUDENT_DISCOUNT_SCOPE;
    await invalidateProof(scope, commit);
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "TERMINATE" });
      } catch {
        // ignore
      }
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    await terminateCurveBn128();
  }
}
