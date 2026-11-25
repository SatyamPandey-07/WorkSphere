export type ZkpWorkerRequestMessage = {
  type: "prove" | "reset";
  jobId: string;
  witness?: unknown;
  requestedPages?: number;
  maxPages?: number;
  prover?: (ctx: {
    witness: unknown;
    memory: WebAssembly.Memory | null;
    signal: AbortSignal;
  }) => Promise<unknown> | unknown;
};

export type ZkpWorkerResponseMessage =
  | {
      type: "result";
      jobId: string;
      result: unknown;
    }
  | {
      type: "error";
      jobId: string;
      error: {
        code:
          | "MEMORY_LIMIT_EXCEEDED"
          | "MEMORY_GROW_FAILED"
          | "OUT_OF_BOUNDS"
          | "WORKER_ERROR";
        message: string;
      };
    }
  | {
      type: "reset";
      jobId: string;
    };

export class ZkpMemoryBoundaryError extends Error {
  public readonly code:
    "MEMORY_LIMIT_EXCEEDED" | "MEMORY_GROW_FAILED" | "OUT_OF_BOUNDS";

  constructor(
    code: "MEMORY_LIMIT_EXCEEDED" | "MEMORY_GROW_FAILED" | "OUT_OF_BOUNDS",
    message: string,
  ) {
    super(message);
    this.name = "ZkpMemoryBoundaryError";
    this.code = code;
  }
}

export const WASM_PAGE_BYTES = 65_536;
export const DEFAULT_MAX_WASM_PAGES = 1024; // 64 MiB default ceiling
export const MAX_WITNESS_BYTES = 16 * 1024 * 1024; // 16 MiB witness budget

type WorkerScopeLike = {
  onmessage: ((event: MessageEvent<ZkpWorkerRequestMessage>) => void) | null;
  postMessage: (message: ZkpWorkerResponseMessage) => void;
  addEventListener?: (
    type: "message" | "error" | "unhandledrejection",
    listener: (event: any) => void,
  ) => void;
};

function classifyMemoryError(
  err: unknown,
): ZkpMemoryBoundaryError["code"] | null {
  if (err instanceof ZkpMemoryBoundaryError) {
    return err.code;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";

  if (
    name === "RangeError" ||
    /out of bounds|memory access out of bounds|index out of range|invalid array length/i.test(
      msg,
    )
  ) {
    return "OUT_OF_BOUNDS";
  }
  if (/webassembly\.memory\.grow|failed to grow memory|grow\(\)/i.test(msg)) {
    return "MEMORY_GROW_FAILED";
  }
  if (/memory limit|page cap|witness.*large|allocation failed|oom/i.test(msg)) {
    return "MEMORY_LIMIT_EXCEEDED";
  }
  return null;
}

export function estimateWitnessBytes(witness: unknown): number {
  if (witness == null) return 0;
  if (witness instanceof ArrayBuffer) return witness.byteLength;
  if (ArrayBuffer.isView(witness)) return witness.byteLength;
  if (typeof witness === "string") return witness.length * 2;
  if (Array.isArray(witness) || typeof witness === "object") {
    try {
      const json = JSON.stringify(witness);
      return json ? json.length * 2 : 0;
    } catch {
      throw new ZkpMemoryBoundaryError(
        "MEMORY_LIMIT_EXCEEDED",
        "Witness payload is not serializable.",
      );
    }
  }
  return 64;
}

export class ZkpWorkerController {
  private memory: WebAssembly.Memory | null = null;
  private activeJobId: string | null = null;
  private abortController: AbortController | null = null;
  private activeScratchBuffer: Uint8Array | null = null;
  private readonly defaultMaxPages: number;

  constructor(defaultMaxPages = DEFAULT_MAX_WASM_PAGES) {
    this.defaultMaxPages = defaultMaxPages;
  }

  public resetState(): void {
    if (this.abortController) {
      this.abortController.abort(
        new Error("Worker job cancelled due to state reset"),
      );
      this.abortController = null;
    }
    this.activeJobId = null;
    this.activeScratchBuffer = null;
    this.memory = null;
  }

  public ensureLinearMemory(
    requestedPages: number,
    maxPages?: number,
  ): WebAssembly.Memory {
    const ceiling = Math.max(1, maxPages ?? this.defaultMaxPages);
    const targetPages = Math.max(1, Math.floor(requestedPages));

    if (targetPages > ceiling) {
      throw new ZkpMemoryBoundaryError(
        "MEMORY_LIMIT_EXCEEDED",
        `Requested ${targetPages} WASM pages exceeds cap of ${ceiling} pages.`,
      );
    }

    if (!this.memory) {
      try {
        this.memory = new WebAssembly.Memory({
          initial: targetPages,
          maximum: ceiling,
        });
      } catch (err) {
        throw new ZkpMemoryBoundaryError(
          "MEMORY_GROW_FAILED",
          `Failed to allocate initial WASM memory (${targetPages} pages): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return this.memory;
    }

    const currentPages = Math.floor(
      this.memory.buffer.byteLength / WASM_PAGE_BYTES,
    );
    if (targetPages > currentPages) {
      const deltaPages = targetPages - currentPages;
      try {
        const prevByteLength = this.memory.buffer.byteLength;
        this.memory.grow(deltaPages);
        if (this.memory.buffer.byteLength <= prevByteLength) {
          throw new ZkpMemoryBoundaryError(
            "MEMORY_GROW_FAILED",
            "WebAssembly.Memory.grow returned without expanding linear memory.",
          );
        }
      } catch (err) {
        if (err instanceof ZkpMemoryBoundaryError) throw err;
        throw new ZkpMemoryBoundaryError(
          "MEMORY_GROW_FAILED",
          `WebAssembly.Memory.grow(${deltaPages}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.memory;
  }

  public allocateWitnessBuffer(
    witness: unknown,
    maxBytes = MAX_WITNESS_BYTES,
  ): Uint8Array {
    const estimated = estimateWitnessBytes(witness);
    if (estimated > maxBytes) {
      throw new ZkpMemoryBoundaryError(
        "MEMORY_LIMIT_EXCEEDED",
        `Witness size (${estimated} bytes) exceeds limit (${maxBytes} bytes).`,
      );
    }

    try {
      const buf = new Uint8Array(Math.max(16, estimated));
      this.activeScratchBuffer = buf;
      return buf;
    } catch (err) {
      throw new ZkpMemoryBoundaryError(
        "MEMORY_LIMIT_EXCEEDED",
        `Failed to allocate witness scratch buffer: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  public async handleMessage(
    msg: ZkpWorkerRequestMessage,
  ): Promise<ZkpWorkerResponseMessage> {
    const jobId = msg?.jobId ?? "unknown-job";

    if (msg?.type === "reset") {
      this.resetState();
      return { type: "reset", jobId };
    }

    this.resetState();
    this.activeJobId = jobId;
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const witnessBytes = estimateWitnessBytes(msg.witness);
      if (witnessBytes > MAX_WITNESS_BYTES) {
        throw new ZkpMemoryBoundaryError(
          "MEMORY_LIMIT_EXCEEDED",
          `Witness size (${witnessBytes} bytes) exceeds maximum allowed (${MAX_WITNESS_BYTES} bytes).`,
        );
      }

      const pagesFromWitness = Math.max(
        1,
        Math.ceil((witnessBytes * 2) / WASM_PAGE_BYTES),
      );
      const requestedPages = msg.requestedPages ?? pagesFromWitness;
      const memory = this.ensureLinearMemory(requestedPages, msg.maxPages);
      this.allocateWitnessBuffer(msg.witness);

      if (controller.signal.aborted) {
        throw new Error("Proof job was aborted");
      }

      const output = msg.prover
        ? await Promise.resolve().then(() =>
            msg.prover!({
              witness: msg.witness,
              memory,
              signal: controller.signal,
            }),
          )
        : {
            verified: true,
            pagesAllocated: Math.floor(
              memory.buffer.byteLength / WASM_PAGE_BYTES,
            ),
          };

      this.activeJobId = null;
      this.abortController = null;
      this.activeScratchBuffer = null;

      return {
        type: "result",
        jobId,
        result: output,
      };
    } catch (err) {
      // Cleanly clear per-job state after any failure so subsequent jobs start fresh.
      this.resetState();

      const classified = classifyMemoryError(err);
      const code = classified ?? "WORKER_ERROR";
      const message =
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string" && err
            ? err
            : "Unknown ZKP worker failure";

      return {
        type: "error",
        jobId,
        error: { code, message },
      };
    }
  }
}

export function attachZkpWorker(scope: WorkerScopeLike): ZkpWorkerController {
  const controller = new ZkpWorkerController();

  const onMessage = (event: MessageEvent<ZkpWorkerRequestMessage>) => {
    const payload = event?.data;
    if (!payload) return;

    void controller
      .handleMessage(payload)
      .then((response) => {
        scope.postMessage(response);
      })
      .catch((fallbackErr) => {
        scope.postMessage({
          type: "error",
          jobId: payload.jobId ?? "unknown-job",
          error: {
            code: "WORKER_ERROR",
            message:
              fallbackErr instanceof Error
                ? fallbackErr.message
                : String(fallbackErr),
          },
        });
      });
  };

  scope.onmessage = onMessage;
  scope.addEventListener?.("message", onMessage);

  return controller;
}

const globalScope = globalThis as unknown as WorkerScopeLike & {
  DedicatedWorkerGlobalScope?: unknown;
};

if (
  typeof globalScope.postMessage === "function" &&
  typeof globalScope.DedicatedWorkerGlobalScope !== "undefined"
) {
  attachZkpWorker(globalScope);
}
