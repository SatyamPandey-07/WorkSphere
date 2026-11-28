export const WASM_PAGE_BYTES = 64 * 1024;
export const MAX_ZKP_WITNESS_BYTES = 16 * 1024 * 1024;

export interface ZkpProverContext {
  memory: WebAssembly.Memory;
  witness?: unknown;
}

export interface ZkpWorkerRequestMessage {
  type: "prove";
  jobId: string;
  requestedPages?: number;
  maxPages?: number;
  witness?: unknown;
  prover?: (context: ZkpProverContext) => unknown | Promise<unknown>;
}

export type ZkpWorkerResponseMessage =
  | { type: "result"; jobId: string; result: unknown }
  | {
      type: "error";
      jobId: string;
      error: { code: string; message: string };
    };

function getWitnessByteLength(witness: unknown): number {
  if (witness instanceof ArrayBuffer) return witness.byteLength;
  if (ArrayBuffer.isView(witness)) return witness.byteLength;
  if (witness === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(witness) ?? "").byteLength;
}

function errorResponse(
  jobId: string,
  code: string,
  message: string,
): ZkpWorkerResponseMessage {
  return { type: "error", jobId, error: { code, message } };
}

function getProverError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("out of bounds") ||
    normalized.includes("detached array buffer")
  ) {
    return { code: "OUT_OF_BOUNDS", message };
  }
  if (
    normalized.includes("memory.grow") ||
    (normalized.includes("memory") && normalized.includes("maximum"))
  ) {
    return { code: "MEMORY_GROW_FAILED", message };
  }
  return { code: "PROVER_FAILED", message };
}

function hasOutOfBoundsMemoryView(
  value: unknown,
  memory: WebAssembly.Memory,
): boolean {
  if (!ArrayBuffer.isView(value) || value.buffer !== memory.buffer) {
    return false;
  }
  return (
    value.byteOffset + value.byteLength > memory.buffer.byteLength ||
    (value.byteLength === 0 && value.byteOffset >= memory.buffer.byteLength)
  );
}

export class ZkpWorkerController {
  private readonly maxPages: number;
  private activeScratchBuffer: WebAssembly.Memory | null = null;
  private activeJobId: string | null = null;

  constructor(maxPages = 1024) {
    this.maxPages =
      Number.isSafeInteger(maxPages) && maxPages > 0 ? maxPages : 1024;
  }

  async handleMessage(
    request: ZkpWorkerRequestMessage,
  ): Promise<ZkpWorkerResponseMessage> {
    const jobId =
      typeof request?.jobId === "string" && request.jobId.length > 0
        ? request.jobId
        : "unknown";

    try {
      if (getWitnessByteLength(request.witness) > MAX_ZKP_WITNESS_BYTES) {
        return errorResponse(
          jobId,
          "MEMORY_LIMIT_EXCEEDED",
          "Witness payload exceeds the configured memory limit.",
        );
      }
    } catch (error) {
      return errorResponse(
        jobId,
        "INVALID_WITNESS",
        error instanceof Error ? error.message : String(error),
      );
    }

    const requestedPages = request.requestedPages ?? 1;
    const requestMaxPages = request.maxPages ?? this.maxPages;
    const effectiveMaxPages = Math.min(this.maxPages, requestMaxPages);
    if (
      !Number.isSafeInteger(requestedPages) ||
      requestedPages < 1 ||
      !Number.isSafeInteger(requestMaxPages) ||
      requestMaxPages < 1 ||
      requestedPages > effectiveMaxPages
    ) {
      return errorResponse(
        jobId,
        "MEMORY_LIMIT_EXCEEDED",
        "Requested WebAssembly memory exceeds the configured page limit.",
      );
    }

    if (typeof request.prover !== "function") {
      return errorResponse(
        jobId,
        "INVALID_REQUEST",
        "A prover function is required for proof jobs.",
      );
    }

    let scratchBuffer: WebAssembly.Memory;
    try {
      scratchBuffer = new WebAssembly.Memory({
        initial: requestedPages,
        maximum: effectiveMaxPages,
      });
    } catch (error) {
      return errorResponse(
        jobId,
        "MEMORY_ALLOCATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    this.activeScratchBuffer = scratchBuffer;
    this.activeJobId = jobId;
    try {
      const result = await Promise.resolve().then(() =>
        request.prover!({ memory: scratchBuffer, witness: request.witness }),
      );
      if (hasOutOfBoundsMemoryView(result, scratchBuffer)) {
        return errorResponse(
          jobId,
          "OUT_OF_BOUNDS",
          "Prover returned a view outside the active WebAssembly memory.",
        );
      }
      return { type: "result", jobId, result };
    } catch (error) {
      const proverError = getProverError(error);
      return errorResponse(jobId, proverError.code, proverError.message);
    } finally {
      if (
        this.activeJobId === jobId &&
        this.activeScratchBuffer === scratchBuffer
      ) {
        this.activeScratchBuffer = null;
        this.activeJobId = null;
      }
    }
  }
}

export interface ZkpWorkerMessageScope {
  onmessage:
    | ((event: MessageEvent<ZkpWorkerRequestMessage>) => void)
    | null;
  postMessage(message: ZkpWorkerResponseMessage): void;
}

export function attachZkpWorker(
  scope: ZkpWorkerMessageScope,
  maxPages = 1024,
): ZkpWorkerController {
  const controller = new ZkpWorkerController(maxPages);
  scope.onmessage = (event) => {
    void controller.handleMessage(event.data).then((response) => {
      scope.postMessage(response);
    });
  };
  return controller;
}

export interface ZkpWorkerOutboundMessage {
  type: "progress" | "complete";
  jobId: string;
  studentId: string;
  seq: number;
  progress: number;
  timestamp: number;
}

export interface ZkpWorkerQueueJob {
  jobId: string;
  studentId: string;
  stepDelayMs?: number;
  steps?: number;
}

export class ZkpWorkerQueueRunner {
  private queueTail: Promise<void> = Promise.resolve();
  private readonly defaultSteps: number;
  private readonly stepDelayMs: number;
  private readonly nowFn: () => number;

  constructor(
    private readonly emit: (message: ZkpWorkerOutboundMessage) => void,
    options: {
      defaultSteps?: number;
      stepDelayMs?: number;
      nowFn?: () => number;
    } = {},
  ) {
    this.defaultSteps = options.defaultSteps ?? 3;
    this.stepDelayMs = options.stepDelayMs ?? 0;
    this.nowFn = options.nowFn ?? Date.now;
  }

  enqueue(job: ZkpWorkerQueueJob): Promise<void> {
    const run = this.queueTail.then(() => this.runJob(job));
    this.queueTail = run.catch(() => undefined);
    return run;
  }

  private async runJob(job: ZkpWorkerQueueJob): Promise<void> {
    const steps = Number.isSafeInteger(job.steps) && (job.steps ?? 0) > 0
      ? job.steps!
      : this.defaultSteps;
    const delayMs = Number.isFinite(job.stepDelayMs)
      ? Math.max(0, job.stepDelayMs ?? 0)
      : this.stepDelayMs;

    for (let step = 1; step <= steps; step++) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      this.emit({
        type: "progress",
        jobId: job.jobId,
        studentId: job.studentId,
        seq: step,
        progress: Math.floor((step / steps) * 100),
        timestamp: this.nowFn(),
      });
    }

    this.emit({
      type: "complete",
      jobId: job.jobId,
      studentId: job.studentId,
      seq: steps + 1,
      progress: 100,
      timestamp: this.nowFn(),
    });
  }
}