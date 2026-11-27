import type {
  BatchStudentDiscountRequest,
  BatchStudentDiscountResponse,
  BatchStudentDiscountResultItem,
} from "./batch";

export type BatchStudentDiscountStreamEvent =
  | {
      type: "progress";
      item: BatchStudentDiscountResultItem;
      progress: {
        current: number;
        total: number;
        percentage: number;
      };
    }
  | {
      type: "complete";
      data: BatchStudentDiscountResponse;
    }
  | {
      type: "error";
      error: string;
    };

export interface BatchStudentDiscountStreamOptions {
  signal?: AbortSignal;
  endpoint?: string;
  onEvent?: (event: BatchStudentDiscountStreamEvent) => void;
}

export interface BatchStudentDiscountStreamResult {
  events: BatchStudentDiscountStreamEvent[];
  aborted: boolean;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Consumes the student batch-verification NDJSON stream.
 * Cancels the reader when the caller aborts the request.
 */
export async function streamVerifyBatchStudentDiscountProofs(
  request: BatchStudentDiscountRequest,
  options: BatchStudentDiscountStreamOptions = {},
): Promise<BatchStudentDiscountStreamResult> {
  const { signal, endpoint = "/api/student/verify-batch", onEvent } = options;
  const events: BatchStudentDiscountStreamEvent[] = [];

  if (signal?.aborted) {
    return { events, aborted: true };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;

  const handleAbort = () => {
    if (!reader) return;

    try {
      cancellation = reader.cancel(signal?.reason).catch(() => undefined);
    } catch {
      // The reader may already be closed or released.
    }
  };

  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(request),
      signal,
    });

    if (signal?.aborted) {
      return { events, aborted: true };
    }

    if (!response.ok) {
      throw new Error(`Batch verification failed (${response.status})`);
    }

    if (!response.body) {
      throw new Error("Batch verification response has no readable stream");
    }

    reader = response.body.getReader();

    if (signal?.aborted) {
      handleAbort();
      return { events, aborted: true };
    }

    const decoder = new TextDecoder();
    let buffer = "";

    const emitLines = (flush = false) => {
      const lines = buffer.split("\n");
      const remainder = lines.pop() ?? "";

      if (flush && remainder.trim()) lines.push(remainder);
      buffer = flush ? "" : remainder;

      for (const line of lines) {
        if (!line.trim()) continue;

        const event = JSON.parse(line) as BatchStudentDiscountStreamEvent;
        events.push(event);
        onEvent?.(event);
      }
    };

    while (!signal?.aborted) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      emitLines();
    }

    if (!signal?.aborted) {
      buffer += decoder.decode();
      emitLines(true);
    }

    return { events, aborted: Boolean(signal?.aborted) };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      return { events, aborted: true };
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", handleAbort);

    if (signal?.aborted && reader && !cancellation) {
      handleAbort();
    }

    await cancellation?.catch(() => undefined);

    try {
      reader?.releaseLock();
    } catch {
      // Ignore cleanup errors if the reader is already released.
    }
  }
}

