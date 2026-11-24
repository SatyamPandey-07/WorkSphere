import {
  type ZkpWorkerOutgoingMessage,
  releaseZkpWasmMemory,
  ZkpWitnessWorkerPool,
  type ZkpWorkerPoolOptions,
} from "@/workers/zkpWorker";

export const ZKP_WATCHDOG_TIMEOUT_MS = 30_000;
export const ZKP_TIMEOUT_USER_ALERT =
  "Proof generation timed out. Please try again.";

export interface StudentDiscountProofInput {
  studentId: string;
  institutionDomain: string;
  nonce?: string;
}

export interface StudentDiscountProofResult {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    publicSignals: string[];
  };
  timedOut: false;
  canRetry: true;
}

export interface ZkpWorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<ZkpWorkerOutgoingMessage>) => void) | null;
  onerror: ((event: ErrorEvent | unknown) => void) | null;
}

export interface VerifyStudentDiscountOptions {
  timeoutMs?: number;
  workerFactory?: () => ZkpWorkerLike;
  onProgress?: (progress: number, stage?: string) => void;
  poolSize?: number;
}

export class ProofGenerationTimeoutError extends Error {
  public readonly canRetry = true;
  public readonly code = "ZKP_WITNESS_TIMEOUT";

  constructor(message: string = ZKP_TIMEOUT_USER_ALERT) {
    super(message);
    this.name = "ProofGenerationTimeoutError";
  }
}

function defaultWorkerFactory(): ZkpWorkerLike {
  if (typeof Worker !== "undefined") {
    return new Worker("/workers/zkpWorker.js") as unknown as ZkpWorkerLike;
  }
  throw new Error("Web Worker constructor is not available.");
}

export function createStudentDiscountVerifier(
  options: VerifyStudentDiscountOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? ZKP_WATCHDOG_TIMEOUT_MS;
  const createWorker = options.workerFactory ?? defaultWorkerFactory;

  async function generateStudentDiscountProof(
    input: StudentDiscountProofInput,
    callOptions: Pick<
      VerifyStudentDiscountOptions,
      "onProgress" | "timeoutMs"
    > = {},
  ): Promise<StudentDiscountProofResult> {
    const effectiveTimeoutMs = callOptions.timeoutMs ?? timeoutMs;
    const progressCallback = callOptions.onProgress ?? options.onProgress;

    return new Promise<StudentDiscountProofResult>((resolve, reject) => {
      let settled = false;
      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      let worker: ZkpWorkerLike | null = null;

      const clearWatchdog = () => {
        if (watchdogId !== null) {
          clearTimeout(watchdogId);
          watchdogId = null;
        }
      };

      const cleanupListeners = () => {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
        }
      };

      const settleOnce = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupListeners();
        fn();
      };

      const armWatchdog = () => {
        clearWatchdog();
        watchdogId = setTimeout(() => {
          settleOnce(() => {
            if (worker) {
              try {
                worker.postMessage({ type: "ABORT" });
              } catch {
                // Ignore if worker thread is wedged
              }
              try {
                worker.terminate();
              } catch {
                // Ignore termination errors
              }
              worker = null;
            }
            releaseZkpWasmMemory();
            reject(new ProofGenerationTimeoutError(ZKP_TIMEOUT_USER_ALERT));
          });
        }, effectiveTimeoutMs);
      };

      try {
        worker = createWorker();
      } catch (err) {
        settleOnce(() => {
          releaseZkpWasmMemory();
          reject(
            err instanceof Error
              ? err
              : new Error("Unable to initialize proof worker"),
          );
        });
        return;
      }

      worker.onmessage = (event: MessageEvent<ZkpWorkerOutgoingMessage>) => {
        if (settled) return;
        const msg = event?.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "PROOF_PROGRESS") {
          armWatchdog();
          progressCallback?.(msg.progress, msg.stage);
          return;
        }

        if (msg.type === "PROOF_COMPLETE") {
          settleOnce(() => {
            if (worker) {
              try {
                worker.terminate();
              } catch {}
              worker = null;
            }
            releaseZkpWasmMemory();
            resolve({
              proof: msg.proof,
              timedOut: false,
              canRetry: true,
            });
          });
          return;
        }

        if (msg.type === "PROOF_ERROR") {
          settleOnce(() => {
            if (worker) {
              try {
                worker.terminate();
              } catch {}
              worker = null;
            }
            releaseZkpWasmMemory();
            reject(new Error(msg.error || "Proof generation failed"));
          });
        }
      };

      worker.onerror = (event: unknown) => {
        if (settled) return;
        settleOnce(() => {
          if (worker) {
            try {
              worker.terminate();
            } catch {}
            worker = null;
          }
          releaseZkpWasmMemory();
          const detail =
            event && typeof event === "object" && "message" in event
              ? String((event as { message?: unknown }).message ?? "")
              : "";
          reject(
            new Error(
              detail || "WebAssembly proof worker encountered an error",
            ),
          );
        });
      };

      armWatchdog();
      worker.postMessage({
        type: "GENERATE_PROOF",
        payload: input,
      });
    });
  }

  return {
    generateStudentDiscountProof,
    timeoutMs,
    alertMessage: ZKP_TIMEOUT_USER_ALERT,
  };
}

export interface StudentDiscountVerifierOptions
  extends VerifyStudentDiscountOptions, Partial<ZkpWorkerPoolOptions> {
  useWorkerPool?: boolean;
  createWorker?: () => any;
  wasmPath?: string;
  zkeyPath?: string;
}

export class StudentDiscountVerifier {
  private pool: ZkpWitnessWorkerPool | null = null;
  private options: StudentDiscountVerifierOptions;

  constructor(options: StudentDiscountVerifierOptions = {}) {
    this.options = options;
  }

  public getWorkerPool(): ZkpWitnessWorkerPool {
    if (!this.pool) {
      this.pool = new ZkpWitnessWorkerPool({
        poolSize: this.options.poolSize,
        timeoutMs: this.options.timeoutMs,
        workerFactory: this.options.createWorker || this.options.workerFactory,
      });
    }
    return this.pool;
  }

  public async generateProof(inputs: Record<string, unknown>): Promise<{
    proof: unknown;
    publicSignals: string[];
    durationMs: number;
    proofSource: "worker" | "fallback";
  }> {
    if (this.options.useWorkerPool) {
      const pool = this.getWorkerPool();
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await pool.executeTask({
        id: jobId,
        circuitInputs: inputs,
        wasmUrl: this.options.wasmPath,
        zkeyUrl: this.options.zkeyPath,
        timeoutMs: this.options.timeoutMs,
      });
      return {
        proof: res.proof,
        publicSignals: res.publicSignals,
        durationMs: res.durationMs,
        proofSource: "worker",
      };
    }

    const verifier = createStudentDiscountVerifier(this.options);
    const res = await verifier.generateStudentDiscountProof({
      studentId: String(inputs.studentId || inputs.secret || "student"),
      institutionDomain: String(
        inputs.institutionDomain || inputs.root || "edu",
      ),
      nonce: String(inputs.nonce || inputs.epoch || "0"),
    });
    return {
      proof: res.proof,
      publicSignals: res.proof.publicSignals,
      durationMs: 0,
      proofSource: "worker",
    };
  }

  public async verifyOrGenerate(
    input: StudentDiscountProofInput,
  ): Promise<StudentDiscountProofResult> {
    const verifier = createStudentDiscountVerifier(this.options);
    return verifier.generateStudentDiscountProof(input);
  }

  public async terminate(): Promise<void> {
    if (this.pool) {
      await this.pool.terminate();
      this.pool = null;
    }
    releaseZkpWasmMemory();
  }
}
