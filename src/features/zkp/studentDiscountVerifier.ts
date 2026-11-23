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

 * studentDiscountVerifier.ts
 *
 * Client-side and server-side verification orchestrator for Student Discount ZKP.
 * Integrates IndexedDB proof verification caching (#9500) with SnarkJS Groth16 verification.
 * Supports CSP-aware proof generation fallback when Web Worker initialization fails under
 * strict Content Security Policies (CSP: worker-src / script-src) (#9637).
 *
 * Expected flow:
 * 1. Receive proof, public signals, Merkle root, and verification context.
 * 2. Generate the deterministic cache key.
 * 3. Check IndexedDB for a valid cached verification.
 * 4. If a valid cache hit exists, return the successful verification result immediately.
 * 5. If no valid cache entry exists, invoke the existing SnarkJS verification function.
 * 6. If verification returns true, store the successful result in IndexedDB.
 * 7. If verification returns false, do not cache it.
 * 8. If verification throws, preserve existing error-handling behavior and do not cache the result.
 */

import {
  getCachedVerification,
  cacheVerifiedProof,
  type VerificationCacheOptions,
  type VerificationInput,
} from "../../lib/zkp/proofCache";

export interface StudentDiscountVerificationParams {
  proof: unknown;
  publicSignals: (string | number | bigint)[];
  merkleRoot?: string;
  epoch?: number | string;
  circuitId?: string;
  vKey?: unknown;
  vKeyFingerprint?: string;
  cacheOptions?: VerificationCacheOptions;
}

export interface StudentDiscountVerificationResult {
  isValid: boolean;
  fromCache: boolean;
  latencyMs: number;
  reason?: string;
}

export interface StudentProofInputs {
  studentHash?: string;
  epochSalt?: string | number;
  nullifierSecret?: string;
  secret?: string | bigint;
  epoch?: string | number;
  root?: string;
  pathElements?: (string | number | bigint)[];
  pathIndices?: (number | string)[];
  wasmUrl?: string;
  zkeyUrl?: string;
  timeoutMs?: number;
}

export interface StudentProofResult {
  proof: unknown;
  publicSignals: string[];
  source: "worker" | "main-thread-fallback";
  simdAccelerated?: boolean;
}

export interface WorkerCapabilityResult {
  allowed: boolean;
  reason?: string;
  error?: unknown;
}

/** In-flight cache promises to deduplicate concurrent verification requests for the same proof */
const pendingVerifications = new Map<string, Promise<StudentDiscountVerificationResult>>();

/** Tracks whether CSP diagnostic warning was already emitted to prevent log flooding */
let hasEmittedCspWarning = false;

/**
 * Checks whether an error is indicative of CSP, SecurityError, or worker initialization restriction.
 */
export function isCspOrSecurityError(err: unknown): boolean {
  if (!err) return false;
  const errorObj = err as any;
  const name = String(errorObj.name || "");
  const message = String(errorObj.message || errorObj || "").toLowerCase();

  return (
    name === "SecurityError" ||
    message.includes("content security policy") ||
    message.includes("csp") ||
    message.includes("violates the following content security policy directive") ||
    message.includes("security error") ||
    message.includes("worker-src") ||
    message.includes("script-src") ||
    message.includes("blob:") ||
    message.includes("not allowed to load local resource") ||
    message.includes("refused to create a worker")
  );
}

export interface MainThreadProver {
  wtnsCalculate: (
    circuitInputs: unknown,
    wasmUrl: string,
    wtns: unknown,
  ) => Promise<unknown>;
  groth16Prove: (zkeyUrl: string, wtns: unknown) => Promise<{
    proof: unknown;
    publicSignals: string[];
  }>;
}

/**
 * Probes whether Web Worker initialization is allowed in the current environment under active CSP rules.
 */
export function probeWorkerCapability(workerFactory?: () => Worker): WorkerCapabilityResult {
  if (!workerFactory && typeof window === "undefined" && typeof Worker === "undefined") {
    return {
      allowed: false,
      reason: "WORKER_API_UNAVAILABLE",
    };
  }

  try {
    let testWorker: Worker;
    if (workerFactory) {
      testWorker = workerFactory();
    } else if (typeof Worker !== "undefined") {
      testWorker = new Worker(new URL("../../workers/zkpWorker.ts", import.meta.url));
    } else {
      return { allowed: false, reason: "WORKER_API_UNAVAILABLE" };
    }

    // Immediately terminate test worker
    try {
      testWorker.terminate();
    } catch {
      // Ignore termination error
    }

    return { allowed: true };
  } catch (err: unknown) {
    const isCsp = isCspOrSecurityError(err);
    return {
      allowed: false,
      reason: isCsp ? "CSP_SECURITY_RESTRICTION" : "WORKER_CREATION_FAILED",
      error: err,
    };
  }
}

/**
 * Emits sanitized diagnostic warning when Web Worker initialization fails under CSP restrictions.
 * Sanitized to never leak private inputs, nullifierSecret, witness or witness buffers.
 */
export function emitCspFallbackWarning(reason: string, details?: unknown): void {
  if (hasEmittedCspWarning) return;
  hasEmittedCspWarning = true;

  const sanitizedMessage =
    details instanceof Error
      ? details.message
      : typeof details === "string"
      ? details
      : "Restricted worker environment";

  console.warn(
    `[ZKP CSP Fallback] Web Worker initialization blocked (${reason}). Falling back to main-thread cryptographic proof generation.`,
    {
      category: "CSP_RESTRICTION",
      reason,
      details: sanitizedMessage,
    },
  );
}

/**
 * Resets the CSP warning flag (useful for unit testing).
 */
export function resetCspWarningState(): void {
  hasEmittedCspWarning = false;
}

/**
 * Generates ZKP student discount proof directly on the main thread.
 * Used as a fallback when Web Workers are blocked by strict Content Security Policies.
 * Executes full cryptographic witness calculation and Groth16 proving without bypassing validation.
 */
export async function generateStudentProofMainThread(
  inputs: StudentProofInputs,
  progressCallback?: (step: string, progress: number) => void,
  customProver?: MainThreadProver,
): Promise<StudentProofResult> {
  const effectiveSecret = inputs.secret ?? inputs.nullifierSecret ?? inputs.studentHash;
  const effectiveEpoch = inputs.epoch ?? inputs.epochSalt ?? "2026";
  const effectiveRoot =
    inputs.root ?? "1849102948102938401928401928401928401928401928401928401928401928";
  const effectivePathElements = Array.isArray(inputs.pathElements)
    ? inputs.pathElements.map(String)
    : Array(16).fill("0");
  const effectivePathIndices = Array.isArray(inputs.pathIndices)
    ? inputs.pathIndices.map(Number)
    : Array(16).fill(0);

  if (!effectiveSecret || !effectiveEpoch) {
    throw new Error("Missing or malformed proof generation inputs.");
  }

  const wasmUrl = inputs.wasmUrl || "/zkp/student_membership.wasm";
  const zkeyUrl = inputs.zkeyUrl || "/zkp/student_membership.zkey";

  progressCallback?.("INITIALIZING", 0.1);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snarkjs = require("snarkjs");

  progressCallback?.("LOADING_ARTIFACTS", 0.25);

  const circuitInputs = {
    secret: String(effectiveSecret),
    epoch: String(effectiveEpoch),
    root: String(effectiveRoot),
    pathElements: effectivePathElements,
    pathIndices: effectivePathIndices,
  };

  progressCallback?.("WITNESS_GENERATION", 0.5);

  let wtns: { type: string; data?: Uint8Array | null } | null = { type: "mem" };

  try {
    // Cooperative yielding to keep the main thread responsive
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (customProver?.wtnsCalculate) {
      await customProver.wtnsCalculate(circuitInputs, wasmUrl, wtns);
    } else if (snarkjs.wtns && typeof snarkjs.wtns.calculate === "function") {
      await snarkjs.wtns.calculate(circuitInputs, wasmUrl, wtns);
    }

    progressCallback?.("PROOF_SYNTHESIS", 0.8);
    await new Promise((resolve) => setTimeout(resolve, 0));

    let proofResult: { proof: unknown; publicSignals: string[] };

    if (customProver?.groth16Prove) {
      proofResult = await customProver.groth16Prove(zkeyUrl, wtns);
    } else if (snarkjs.groth16 && typeof snarkjs.groth16.prove === "function" && wtns) {
      proofResult = await snarkjs.groth16.prove(zkeyUrl, wtns);
    } else if (snarkjs.groth16 && typeof snarkjs.groth16.fullProve === "function") {
      proofResult = await snarkjs.groth16.fullProve(circuitInputs, wasmUrl, zkeyUrl);
    } else {
      throw new Error("SnarkJS Groth16 prover is unavailable on main thread");
    }

    progressCallback?.("FINALIZING", 1.0);

    return {
      proof: proofResult.proof,
      publicSignals: (proofResult.publicSignals || []).map(String),
      source: "main-thread-fallback",
      simdAccelerated: false,
    };
  } finally {
    if (wtns && wtns.data) {
      try {
        wtns.data.fill(0);
      } catch {
        // ignore
      }
    }
    wtns = null;

    // Terminate BN128 curve memory if applicable
    const g = globalThis as typeof globalThis & {
      curve_bn128?: { terminate: () => Promise<void> };
    };
    if (g.curve_bn128) {
      try {
        await g.curve_bn128.terminate();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Generates a student discount ZKP proof with automatic fallback to main-thread execution
 * if Web Worker creation is disallowed by strict Content Security Policies (CSP) or browser restrictions.
 */
export async function generateStudentProofWithFallback(
  inputs: StudentProofInputs,
  options: {
    workerFactory?: () => Worker;
    onProgress?: (step: string, progress: number) => void;
    forceFallback?: boolean;
    mainThreadProver?: MainThreadProver;
  } = {},
): Promise<StudentProofResult> {
  const { workerFactory, onProgress, forceFallback = false, mainThreadProver } = options;

  if (forceFallback) {
    emitCspFallbackWarning("FORCED_FALLBACK");
    return generateStudentProofMainThread(inputs, onProgress, mainThreadProver);
  }

  // Attempt Web Worker path
  let worker: Worker | null = null;
  try {
    if (workerFactory) {
      worker = workerFactory();
    } else if (typeof Worker !== "undefined") {
      worker = new Worker(new URL("../../workers/zkpWorker.ts", import.meta.url));
    } else {
      throw new Error("Worker API is undefined in current environment");
    }
  } catch (workerInitErr: unknown) {
    const isCsp = isCspOrSecurityError(workerInitErr);
    emitCspFallbackWarning(
      isCsp ? "CSP_SECURITY_RESTRICTION" : "WORKER_INITIALIZATION_ERROR",
      workerInitErr,
    );
    return generateStudentProofMainThread(inputs, onProgress, mainThreadProver);
  }

  // Web Worker was successfully instantiated, dispatch proof generation
  return new Promise<StudentProofResult>((resolve, reject) => {
    let isSettled = false;
    const timeoutMs = inputs.timeoutMs || 30_000;

    const timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      try {
        worker?.terminate();
      } catch {
        // ignore
      }
      reject(new Error("ZKP proof generation timed out in worker"));
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      if (isSettled) return;
      const data = e.data || {};
      const type = String(data.type || "").toUpperCase();

      if (type === "PROGRESS") {
        const step = data.step || data.stage || "PROVING";
        const progress = typeof data.progress === "number" ? data.progress : 0.5;
        onProgress?.(step, progress);
        return;
      }

      if (type === "SUCCESS") {
        isSettled = true;
        clearTimeout(timer);
        try {
          worker?.terminate();
        } catch {
          // ignore
        }
        resolve({
          proof: data.proof,
          publicSignals: (data.publicSignals || []).map(String),
          source: "worker",
          simdAccelerated: data.simdAccelerated,
        });
        return;
      }

      if (type === "ERROR") {
        isSettled = true;
        clearTimeout(timer);
        try {
          worker?.terminate();
        } catch {
          // ignore
        }
        reject(new Error(data.error || "Worker error occurred during proof generation"));
      }
    };

    worker.onerror = (errEvent: ErrorEvent) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        // ignore
      }
      // If worker crashed due to runtime CSP / Security error during execution
      if (isCspOrSecurityError(errEvent)) {
        emitCspFallbackWarning("RUNTIME_CSP_SECURITY_RESTRICTION", errEvent);
        generateStudentProofMainThread(inputs, onProgress, mainThreadProver).then(resolve).catch(reject);
      } else {
        reject(new Error(errEvent.message || "Unknown ZKP Worker error"));
      }
    };

    try {
      worker.postMessage({
        type: "GENERATE_PROOF",
        ...inputs,
      });
    } catch (postErr) {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        // ignore
      }
      if (isCspOrSecurityError(postErr)) {
        emitCspFallbackWarning("POST_MESSAGE_CSP_RESTRICTION", postErr);
        generateStudentProofMainThread(inputs, onProgress, mainThreadProver).then(resolve).catch(reject);
      } else {
        reject(postErr);
      }
    }
  });
}

/**
 * Loads default student membership verification key if not provided.
 */
export async function loadDefaultStudentVerificationKey(): Promise<unknown | null> {
  // If in browser, fetch from static asset
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const res = await fetch("/zkp/student_membership_vkey.json");
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
  }

  // If in Node / Server environment
  try {
    const fs = await import("fs");
    const path = await import("path");
    const vkeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_membership_vkey.json",
    );
    if (fs.existsSync(vkeyPath)) {
      return JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Verifies a student discount Groth16 zero-knowledge proof, querying client IndexedDB cache
 * first to avoid expensive pairing operations on previously verified proofs.
 */
export async function verifyStudentDiscountProof(
  params: StudentDiscountVerificationParams,
  snarkjsVerifier?: (
    vKey: unknown,
    publicSignals: string[],
    proof: unknown,
  ) => Promise<boolean>,
): Promise<StudentDiscountVerificationResult> {
  const start = performance.now();
  const {
    proof,
    publicSignals,
    merkleRoot,
    circuitId = "student_membership",
    vKeyFingerprint,
    cacheOptions = {},
  } = params;

  // Basic validation
  if (!proof || !publicSignals || !Array.isArray(publicSignals) || publicSignals.length === 0) {
    return {
      isValid: false,
      fromCache: false,
      latencyMs: performance.now() - start,
      reason: "Missing or malformed proof/publicSignals",
    };
  }

  // Deduce root if not explicitly provided
  const effectiveRoot = merkleRoot ?? (publicSignals.length >= 1 ? String(publicSignals[0]) : undefined);

  // Load vKey if needed
  let effectiveVKey = params.vKey;
  if (!effectiveVKey && !vKeyFingerprint) {
    effectiveVKey = await loadDefaultStudentVerificationKey();
  }

  const verificationInput: VerificationInput = {
    proof,
    publicSignals,
    merkleRoot: effectiveRoot,
    circuitId,
    vKey: effectiveVKey,
    vKeyFingerprint,
  };

  // Step 1: Check client-side IndexedDB cache
  try {
    const cached = await getCachedVerification(verificationInput, cacheOptions);
    if (cached.hit) {
      return {
        isValid: true,
        fromCache: true,
        latencyMs: performance.now() - start,
      };
    }
  } catch (err) {
    // Caching check failed, fall back to SnarkJS verification
    console.warn("[StudentDiscountVerifier] Cache lookup failed, falling back to SnarkJS:", err);
  }

  // Step 2: Handle concurrency deduplication for in-flight verifications of the same proof
  let cacheKey: string | null = null;
  try {
    const { computeVerificationCacheKey } = await import("../../lib/zkp/proofCache");
    const res = await computeVerificationCacheKey(verificationInput);
    cacheKey = res.cacheKey;
  } catch {
    // Synchronous fallback cacheKey calculation using JSON if import fails
    try {
      cacheKey = JSON.stringify({
        p: (proof as any)?.pi_a,
        s: publicSignals,
        c: circuitId,
      });
    } catch {
      // ignore
    }
  }

  if (cacheKey && pendingVerifications.has(cacheKey)) {
    return pendingVerifications.get(cacheKey)!;
  }

  const runVerificationPromise = (async (): Promise<StudentDiscountVerificationResult> => {
    // Step 3: Perform SnarkJS Groth16 verification
    const stringSignals = publicSignals.map((s) =>
      typeof s === "bigint" ? s.toString() : String(s),
    );

    let isValid = false;
    try {
      if (snarkjsVerifier) {
        isValid = await snarkjsVerifier(effectiveVKey, stringSignals, proof);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const snarkjs = require("snarkjs");
        isValid = await snarkjs.groth16.verify(effectiveVKey, stringSignals, proof);
      }
    } finally {
      // Terminate BN128 curve memory in node if applicable
      const g = globalThis as typeof globalThis & {
        curve_bn128?: { terminate: () => Promise<void> };
      };
      if (g.curve_bn128) {
        try {
          await g.curve_bn128.terminate();
        } catch {
          // ignore
        }
      }
    }

    // Step 4: If verification succeeded, store in IndexedDB
    if (isValid) {
      try {
        await cacheVerifiedProof(verificationInput, cacheOptions);
      } catch (cacheErr) {
        // Caching error must never fail authentication
        console.warn("[StudentDiscountVerifier] Failed to cache verified proof:", cacheErr);
      }
    }

    return {
      isValid,
      fromCache: false,
      latencyMs: performance.now() - start,
    };
  })();

  if (cacheKey) {
    pendingVerifications.set(cacheKey, runVerificationPromise);
    runVerificationPromise
      .catch(() => {})
      .finally(() => {
        pendingVerifications.delete(cacheKey!);
      });
  }

  return runVerificationPromise;

}
