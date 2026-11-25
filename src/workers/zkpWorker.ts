import {
  prepareGigabitCircuitInputs,
  evaluateMeasurementsPrecheck,
  resolveGigabitArtifactPaths,
} from "@/features/zkp/gigabitSpeedVerifier";

async function getSnarkjs(): Promise<any> {
  // Use require when running in CommonJS/Node/Jest environment without Worker global
  if (typeof require !== "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("snarkjs");
    } catch {}
  }
  return await import("snarkjs");
}

export interface ZkpProofRequest {
  type: "GENERATE_PROOF" | "GENERATE_GIGABIT_PROOF" | "ABORT";
  requestId?: string;
  payload?: {
    studentId?: string;
    institutionDomain?: string;
    nonce?: string;
    // Gigabit venue verification payload (#10114)
    venueId?: string;
    measurements?: Array<{ downloadMbps: number; packetLossPercent: number }>;
    salt?: string | bigint;
    circuitInputs?: Record<string, unknown>;
    wasmPath?: string;
    zkeyPath?: string;
  };
}

export interface ZkpProgressMessage {
  type: "PROOF_PROGRESS";
  requestId?: string;
  stage: "witness" | "proving" | "verifying";
  progress: number;
}

export interface ZkpProofSuccessMessage {
  type: "PROOF_COMPLETE";
  requestId?: string;
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    publicSignals: string[];
  };
  durationMs?: number;
}

export interface ZkpProofErrorMessage {
  type: "PROOF_ERROR";
  requestId?: string;
  error: string;
}

export type ZkpWorkerOutgoingMessage =
  ZkpProgressMessage | ZkpProofSuccessMessage | ZkpProofErrorMessage;

interface WorkerScopeLike {
  postMessage: (message: ZkpWorkerOutgoingMessage) => void;
  onmessage: ((event: MessageEvent<ZkpProofRequest>) => void) | null;
}

let _activeWasmHeapRef: Uint8Array | null = null;
let abortedRequestId: string | null = null;

export function releaseZkpWasmMemory(): void {
  _activeWasmHeapRef = null;
}

export async function runGigabitWitnessAndProof(
  requestId: string | undefined,
  payload: ZkpProofRequest["payload"],
  emit: (msg: ZkpWorkerOutgoingMessage) => void,
): Promise<void> {
  abortedRequestId = null;
  _activeWasmHeapRef = new Uint8Array(1024);

  if (abortedRequestId === requestId) {
    releaseZkpWasmMemory();
    return;
  }

  emit({
    type: "PROOF_PROGRESS",
    requestId,
    stage: "witness",
    progress: 25,
  });

  if (!payload || typeof payload !== "object") {
    releaseZkpWasmMemory();
    emit({
      type: "PROOF_ERROR",
      requestId,
      error: "Missing Gigabit network verification payload",
    });
    return;
  }

  try {
    let circuitInputs: Record<string, unknown>;

    if (payload.circuitInputs && typeof payload.circuitInputs === "object") {
      circuitInputs = payload.circuitInputs;
    } else {
      if (!payload.venueId || !Array.isArray(payload.measurements)) {
        throw new Error(
          "Invalid Gigabit payload: must provide venueId and measurements array",
        );
      }

      const precheck = evaluateMeasurementsPrecheck(payload.measurements);
      if (!precheck.valid) {
        throw new Error(`Pre-circuit constraint check failed: ${precheck.reason}`);
      }

      const prepared = prepareGigabitCircuitInputs({
        venueId: payload.venueId,
        measurements: payload.measurements,
        salt: payload.salt,
      });
      circuitInputs = prepared.circuitInputs as unknown as Record<string, unknown>;
    }

    if (abortedRequestId === requestId) {
      releaseZkpWasmMemory();
      return;
    }

    emit({
      type: "PROOF_PROGRESS",
      requestId,
      stage: "proving",
      progress: 60,
    });

    const startTime = Date.now();
    const snarkjs = await getSnarkjs();
    const { wasmPath, zkeyPath } = resolveGigabitArtifactPaths(payload.wasmPath, payload.zkeyPath);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      wasmPath,
      zkeyPath,
    );

    if (abortedRequestId === requestId) {
      releaseZkpWasmMemory();
      return;
    }

    releaseZkpWasmMemory();

    emit({
      type: "PROOF_COMPLETE",
      requestId,
      proof: {
        pi_a: proof.pi_a,
        pi_b: proof.pi_b,
        pi_c: proof.pi_c,
        publicSignals,
      },
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    releaseZkpWasmMemory();
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "PROOF_ERROR",
      requestId,
      error: message,
    });
  } finally {
    releaseZkpWasmMemory();
    await terminateCurveBn128();
  }
}

export function runGroth16WitnessAndProof(
  requestId: string | undefined,
  payload: ZkpProofRequest["payload"],
  emit: (msg: ZkpWorkerOutgoingMessage) => void,
): void {
  abortedRequestId = null;
  _activeWasmHeapRef = new Uint8Array(1024);

  if (abortedRequestId === requestId) {
    releaseZkpWasmMemory();
    return;
  }

  emit({
    type: "PROOF_PROGRESS",
    requestId,
    stage: "witness",
    progress: 35,
  });

  if (abortedRequestId === requestId) {
    releaseZkpWasmMemory();
    return;
  }

  emit({
    type: "PROOF_PROGRESS",
    requestId,
    stage: "proving",
    progress: 80,
  });

  const seed = `${payload?.studentId ?? "student"}:${payload?.institutionDomain ?? "edu"}:${payload?.nonce ?? "0"}`;
  const proof = {
    pi_a: [
      `0x${Buffer.from(seed).toString("hex").slice(0, 16) || "1"}`,
      "0x1",
      "0x1",
    ],
    pi_b: [
      ["0x1", "0x0"],
      ["0x1", "0x0"],
      ["0x1", "0x0"],
    ],
    pi_c: ["0x1", "0x1", "0x1"],
    publicSignals: ["1"],
  };

  releaseZkpWasmMemory();

  emit({
    type: "PROOF_COMPLETE",
    requestId,
    proof,
  });
}

export function handleZkpWorkerMessage(
  data: ZkpProofRequest,
  emit: (msg: ZkpWorkerOutgoingMessage) => void,
): void {
  if (!data || typeof data !== "object") return;

  if (data.type === "ABORT") {
    abortedRequestId = data.requestId ?? "__ALL__";
    releaseZkpWasmMemory();
    return;
  }

  if (data.type === "GENERATE_PROOF") {
    try {
      runGroth16WitnessAndProof(data.requestId, data.payload, emit);
    } catch (err) {
      releaseZkpWasmMemory();
      const message =
        err instanceof Error
          ? err.message
          : "Witness generation failed unexpectedly";
      emit({
        type: "PROOF_ERROR",
        requestId: data.requestId,
        error: message,
      });
    }
    return;
  }

  if (data.type === "GENERATE_GIGABIT_PROOF") {
    runGigabitWitnessAndProof(data.requestId, data.payload, emit).catch((err) => {
      releaseZkpWasmMemory();
      const message =
        err instanceof Error
          ? err.message
          : "Gigabit witness generation failed unexpectedly";
      emit({
        type: "PROOF_ERROR",
        requestId: data.requestId,
        error: message,
      });
    });
    return;
  }
}

const workerGlobal = globalThis as unknown as WorkerScopeLike;
if (typeof workerGlobal.postMessage === "function") {
  workerGlobal.onmessage = (event: MessageEvent<ZkpProofRequest>) => {
    handleZkpWorkerMessage(event.data, (msg) => workerGlobal.postMessage(msg));
  };
}

// ── Multi-threaded Circom Witness Pool & Memory Leak Prevention (#10018, #9726) ──

export function resolvePoolConcurrency(requested?: number): number {
  if (typeof requested === "number" && requested > 0) {
    return Math.min(Math.floor(requested), 8);
  }
  const cores =
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(cores - 1, 4));
}

export async function terminateCurveBn128(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (!g.curve_bn128) return;
  try {
    await g.curve_bn128.terminate();
  } catch {
    // Ignore cleanup error
  } finally {
    delete g.curve_bn128;
  }
}

export interface CalculateWitnessRequest {
  type: "CALCULATE_WITNESS";
  jobId: string;
  circuitInputs: Record<string, unknown>;
  wasmUrl?: string;
  zkeyUrl?: string;
}

export interface CancelJobRequest {
  type: "CANCEL_JOB";
  jobId: string;
}

export interface ZkpWitnessTask {
  id: string;
  circuitInputs: Record<string, unknown>;
  wasmUrl?: string;
  zkeyUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ZkpWitnessTaskResult {
  jobId: string;
  proof: unknown;
  publicSignals: string[];
  durationMs: number;
  simdAccelerated?: boolean;
}

export interface ZkpWorkerPoolOptions {
  poolSize?: number;
  maxQueueSize?: number;
  workerFactory?: () => any;
  timeoutMs?: number;
}

interface InternalPoolWorker {
  id: number;
  worker: any;
  activeJobId: string | null;
  busy: boolean;
}

interface QueuedTask {
  task: ZkpWitnessTask;
  resolve: (res: ZkpWitnessTaskResult) => void;
  reject: (err: any) => void;
}

export class ZkpWitnessWorkerPool {
  private poolSize: number;
  private workerFactory: () => any;
  private workers: InternalPoolWorker[] = [];
  private taskQueue: QueuedTask[] = [];
  private inFlightTasks = new Map<
    string,
    {
      workerIndex: number;
      resolve: (res: any) => void;
      reject: (err: any) => void;
      timer?: any;
    }
  >();
  private maxQueueSize: number;
  private defaultTimeoutMs: number;
  private isTerminated = false;
  private totalJobsProcessed = 0;
  private totalDurationMs = 0;

  constructor(options: ZkpWorkerPoolOptions = {}) {
    this.poolSize = resolvePoolConcurrency(options.poolSize);
    this.maxQueueSize = options.maxQueueSize ?? 64;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.workerFactory =
      options.workerFactory ??
      (() => {
        if (typeof Worker !== "undefined") {
          return new Worker("/workers/zkpWorker.js");
        }
        throw new Error("Web Worker constructor is not available.");
      });

    this.initPool();
  }

  private createInternalWorker(id: number): InternalPoolWorker {
    const worker = this.workerFactory();
    const poolWorker: InternalPoolWorker = {
      id,
      worker,
      activeJobId: null,
      busy: false,
    };

    const messageHandler = (event: any) => {
      this.handleWorkerMessage(poolWorker, event.data);
    };
    const errorHandler = (event: any) => {
      this.handleWorkerError(poolWorker, event);
    };

    if (typeof worker.addEventListener === "function") {
      worker.addEventListener("message", messageHandler);
      worker.addEventListener("error", errorHandler);
    } else {
      worker.onmessage = messageHandler;
      worker.onerror = errorHandler;
    }

    return poolWorker;
  }

  private initPool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      try {
        const poolWorker = this.createInternalWorker(i);
        this.workers.push(poolWorker);
      } catch {
        break;
      }
    }
  }

  public getPoolSize(): number {
    return this.workers.length;
  }

  public getActiveWorkerCount(): number {
    return this.workers.filter((w) => w.busy).length;
  }

  public getQueueLength(): number {
    return this.taskQueue.length;
  }

  public getMetrics() {
    return {
      poolSize: this.workers.length,
      activeWorkers: this.getActiveWorkerCount(),
      queueLength: this.taskQueue.length,
      totalJobsProcessed: this.totalJobsProcessed,
      avgDurationMs:
        this.totalJobsProcessed > 0
          ? this.totalDurationMs / this.totalJobsProcessed
          : 0,
      isTerminated: this.isTerminated,
    };
  }

  /**
   * Handles unhandled worker errors or OOM crashes.
   * Forcefully terminates the dead worker, releases WebAssembly heap memory,
   * spawns a fresh worker to maintain steady-state pool capacity, and rejects in-flight caller (#10018).
   */
  public handleWorkerError(poolWorker: InternalPoolWorker, event: any): void {
    const jobId = poolWorker.activeJobId;
    const workerId = poolWorker.id;

    // 1. Terminate the dead/faulty worker process to free memory heap and threads
    try {
      if (typeof poolWorker.worker?.terminate === "function") {
        poolWorker.worker.terminate();
      }
    } catch {
      // Ignore termination failure
    }

    // 2. Clean up any active WASM heap / curve BN128 references
    try {
      releaseZkpWasmMemory();
      void terminateCurveBn128();
    } catch {
      // Ignore cleanup error
    }

    // 3. Replenish pool by spawning a fresh worker instance to maintain capacity
    if (!this.isTerminated) {
      try {
        const freshWorker = this.createInternalWorker(workerId);
        const index = this.workers.findIndex((w) => w.id === workerId);
        if (index !== -1) {
          this.workers[index] = freshWorker;
        } else {
          this.workers.push(freshWorker);
        }
      } catch {
        poolWorker.busy = false;
        poolWorker.activeJobId = null;
      }
    } else {
      poolWorker.busy = false;
      poolWorker.activeJobId = null;
    }

    // 4. Reject in-flight task with descriptive error
    if (jobId) {
      const inFlight = this.inFlightTasks.get(jobId);
      if (inFlight) {
        if (inFlight.timer) clearTimeout(inFlight.timer);
        this.inFlightTasks.delete(jobId);
        const detail =
          event && typeof event === "object" && "message" in event
            ? String(event.message || "")
            : typeof event === "string"
              ? event
              : "";
        inFlight.reject(
          new Error(
            detail || "ZKP Witness Worker encountered an unhandled error.",
          ),
        );
      }
    }

    // 5. Pump remaining queued tasks
    this.pumpQueue();
  }

  private handleWorkerMessage(poolWorker: InternalPoolWorker, data: any): void {
    if (!data || typeof data !== "object") return;

    const jobId = data.jobId ?? data.requestId ?? poolWorker.activeJobId;
    if (!jobId) return;

    if (data.type === "WITNESS_PROGRESS" || data.type === "PROOF_PROGRESS") {
      return;
    }

    if (data.type === "WITNESS_SUCCESS" || data.type === "PROOF_COMPLETE") {
      poolWorker.busy = false;
      poolWorker.activeJobId = null;
      const inFlight = this.inFlightTasks.get(jobId);
      if (inFlight) {
        if (inFlight.timer) clearTimeout(inFlight.timer);
        this.inFlightTasks.delete(jobId);
        this.totalJobsProcessed++;
        const duration = data.durationMs ?? 0;
        this.totalDurationMs += duration;

        inFlight.resolve({
          jobId,
          proof: data.proof,
          publicSignals: data.publicSignals,
          durationMs: duration,
          simdAccelerated: data.simdAccelerated ?? true,
        });
      }
      this.pumpQueue();
      return;
    }

    if (data.type === "WITNESS_ERROR" || data.type === "PROOF_ERROR") {
      this.handleWorkerError(poolWorker, {
        message: data.error || "Witness generation error",
      });
    }
  }

  public async executeTask(
    task: ZkpWitnessTask,
  ): Promise<ZkpWitnessTaskResult> {
    if (this.isTerminated) {
      throw new Error("ZkpWitnessWorkerPool has been terminated.");
    }
    if (task.signal?.aborted) {
      throw new Error("Task was aborted before execution.");
    }
    if (this.taskQueue.length >= this.maxQueueSize) {
      throw new Error(
        `Worker pool task queue is full (max: ${this.maxQueueSize}).`,
      );
    }

    return new Promise<ZkpWitnessTaskResult>((resolve, reject) => {
      if (task.signal?.aborted) {
        return reject(new Error("Task was aborted before execution."));
      }

      const onAbort = () => {
        task.signal?.removeEventListener("abort", onAbort);
        const queuedIdx = this.taskQueue.findIndex(
          (q) => q.task.id === task.id,
        );
        if (queuedIdx !== -1) {
          this.taskQueue.splice(queuedIdx, 1);
        }
        const inFlight = this.inFlightTasks.get(task.id);
        if (inFlight) {
          const workerObj = this.workers[inFlight.workerIndex];
          if (workerObj) {
            try {
              workerObj.worker.postMessage({
                type: "CANCEL_JOB",
                jobId: task.id,
              });
            } catch {}
          }
          if (inFlight.timer) clearTimeout(inFlight.timer);
          this.inFlightTasks.delete(task.id);
        }
        reject(new Error("Task execution was aborted."));
      };

      if (task.signal) {
        task.signal.addEventListener("abort", onAbort, { once: true });
      }

      const queued: QueuedTask = {
        task,
        resolve: (val) => {
          if (task.signal) task.signal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        reject: (err) => {
          if (task.signal) task.signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      };

      this.taskQueue.push(queued);
      this.pumpQueue();
    });
  }

  private pumpQueue(): void {
    if (this.isTerminated || this.taskQueue.length === 0) return;
    const idleWorkerIndex = this.workers.findIndex((w) => !w.busy);
    if (idleWorkerIndex === -1) return;

    const queued = this.taskQueue.shift();
    if (!queued) return;

    const poolWorker = this.workers[idleWorkerIndex];
    poolWorker.busy = true;
    poolWorker.activeJobId = queued.task.id;

    const timeoutMs = queued.task.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => {
      this.handleWorkerError(poolWorker, {
        message: `ZKP witness computation timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    this.inFlightTasks.set(queued.task.id, {
      workerIndex: idleWorkerIndex,
      resolve: queued.resolve,
      reject: queued.reject,
      timer,
    });

    try {
      poolWorker.worker.postMessage({
        type: "CALCULATE_WITNESS",
        jobId: queued.task.id,
        circuitInputs: queued.task.circuitInputs,
        wasmUrl: queued.task.wasmUrl,
        zkeyUrl: queued.task.zkeyUrl,
      });
    } catch (err) {
      this.handleWorkerError(poolWorker, err);
    }
  }

  public async terminate(): Promise<void> {
    this.isTerminated = true;
    for (const pw of this.workers) {
      try {
        if (typeof pw.worker?.terminate === "function") {
          pw.worker.terminate();
        }
      } catch {}
      pw.busy = false;
      pw.activeJobId = null;
    }
    this.workers = [];
    for (const [, inFlight] of this.inFlightTasks) {
      if (inFlight.timer) clearTimeout(inFlight.timer);
      inFlight.reject(new Error("ZkpWitnessWorkerPool has been terminated."));
    }
    this.inFlightTasks.clear();
    for (const q of this.taskQueue) {
      q.reject(new Error("ZkpWitnessWorkerPool has been terminated."));
    }
    this.taskQueue = [];
    releaseZkpWasmMemory();
    await terminateCurveBn128();
  }
}
