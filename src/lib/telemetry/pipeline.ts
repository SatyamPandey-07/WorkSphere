import type {
  TelemetryBatchHandler,
  TelemetrySubscriber,
  TelemetryMiddleware,
  TelemetryPipelineOptions,
} from "./types";

/**
 * Core TelemetryPipeline managing queuing, flush scheduling, middleware execution,
 * subscriber dispatch, and batch processing.
 */
export class TelemetryPipeline<T = unknown> {
  public readonly name: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private batchHandler?: TelemetryBatchHandler<T>;

  private buffer: T[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private middlewares: TelemetryMiddleware<T>[] = [];
  private subscribers: TelemetrySubscriber<T>[] = [];
  private isFlushing = false;

  constructor(options: TelemetryPipelineOptions<T> = {}) {
    this.name = options.name || "default";
    this.batchSize = Math.max(1, options.batchSize || 100);
    this.flushIntervalMs = Math.max(500, options.flushIntervalMs || 5000);
    this.maxBufferSize = Math.max(this.batchSize, options.maxBufferSize || this.batchSize * 10);
    this.batchHandler = options.batchHandler;
  }

  /**
   * Registers a middleware filter/transform. Returning null drops the event.
   */
  public use(middleware: TelemetryMiddleware<T>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Registers a subscriber/detector to receive processed events.
   */
  public subscribe(subscriber: TelemetrySubscriber<T>): this {
    this.subscribers.push(subscriber);
    return this;
  }

  /**
   * Enqueues an event through the middleware chain and notifies subscribers.
   */
  public async enqueue(event: T): Promise<boolean> {
    let currentEvent: T | null = event;

    for (const middleware of this.middlewares) {
      currentEvent = await middleware(currentEvent);
      if (currentEvent === null) {
        return false;
      }
    }

    // Notify subscribers in background
    for (const subscriber of this.subscribers) {
      try {
        void subscriber(currentEvent);
      } catch (err) {
        console.error(`[TelemetryPipeline:${this.name}] Subscriber error:`, err);
      }
    }

    this.buffer.push(currentEvent);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }

    return true;
  }

  /**
   * Flushes the next batch of queued events to the batchHandler.
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0 || !this.batchHandler) {
      return;
    }

    this.isFlushing = true;
    const batch = this.buffer.splice(0, this.batchSize);

    try {
      await this.batchHandler(batch);
    } catch (err) {
      console.error(`[TelemetryPipeline:${this.name}] Batch flush error:`, err);
      // Re-insert unhandled batch items at the beginning of the buffer
      this.buffer.unshift(...batch);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Starts periodic flush scheduler.
   */
  public startFlusher(): void {
    if (this.flushTimer) return;
    if (typeof window !== "undefined") return;

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error(`[TelemetryPipeline:${this.name}] Unhandled flush error:`, err);
      });
    }, this.flushIntervalMs);

    if (this.flushTimer && typeof this.flushTimer.unref === "function") {
      this.flushTimer.unref();
    }
  }

  /**
   * Stops the flush scheduler and drains remaining items.
   */
  public async stopFlusher(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length > 0 && this.batchHandler) {
      const remaining = [...this.buffer];
      this.buffer = [];
      try {
        await this.batchHandler(remaining);
      } catch (err) {
        console.error(`[TelemetryPipeline:${this.name}] Final flush failed:`, err);
      }
    }
  }

  public getQueueDepth(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }
}
