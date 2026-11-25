/**
 * AdaptiveRequestBatcher.ts
 * High-performance adaptive micro-batching request accumulator with per-item SLA deadlines,
 * EWMA arrival velocity tracking, multi-tier priority scheduling, and promise demultiplexing.
 */

export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'STANDARD' | 'BACKGROUND';

export type BackpressurePolicy = 'CALLER_BLOCK' | 'DROP_LOWEST_PRIORITY' | 'REJECT_IMMEDIATE';

export interface BatchItem<TPayload, TResult> {
  id: string;
  payload: TPayload;
  priority: PriorityLevel;
  slaDeadlineMs: number;
  enqueuedAt: number;
  resolve: (value: TResult) => void;
  reject: (reason?: any) => void;
}

export interface BatcherOptions<TPayload, TResult> {
  name?: string;
  minBatchSize?: number;       // Default 1
  maxBatchSize?: number;       // Default 50
  maxWaitMs?: number;          // Default 50ms
  defaultSlaMs?: number;       // Default 25ms
  maxQueueCapacity?: number;   // Default 1000
  executor: (items: TPayload[]) => Promise<TResult[]>;
  backpressurePolicy?: BackpressurePolicy;
}

export interface BatcherMetrics {
  name: string;
  totalEnqueued: number;
  totalProcessed: number;
  totalFlushes: number;
  slaBreachCount: number;
  averageBatchSize: number;
  averageLatencyMs: number;
  currentQueueDepth: number;
  estimatedArrivalRatePerSec: number;
}

const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  STANDARD: 2,
  BACKGROUND: 3,
};

export class AdaptiveRequestBatcher<TPayload, TResult> {
  private readonly name: string;
  private readonly minBatchSize: number;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly defaultSlaMs: number;
  private readonly maxQueueCapacity: number;
  private readonly executor: (items: TPayload[]) => Promise<TResult[]>;
  private readonly backpressurePolicy: BackpressurePolicy;

  private queue: BatchItem<TPayload, TResult>[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private isShutdown: boolean = false;

  // Adaptive arrival rate tracking (EWMA)
  private lastEnqueueTime: number = 0;
  private smoothedIntervalMs: number = 20; // Initial prior ~50 req/sec
  private readonly ewmaAlpha: number = 0.2;

  // Metrics
  private totalEnqueued: number = 0;
  private totalProcessed: number = 0;
  private totalFlushes: number = 0;
  private slaBreachCount: number = 0;
  private totalLatencyAccumulator: number = 0;

  constructor(options: BatcherOptions<TPayload, TResult>) {
    this.name = options.name || 'AdaptiveRequestBatcher';
    this.minBatchSize = options.minBatchSize ?? 1;
    this.maxBatchSize = options.maxBatchSize ?? 50;
    this.maxWaitMs = options.maxWaitMs ?? 50;
    this.defaultSlaMs = options.defaultSlaMs ?? 25;
    this.maxQueueCapacity = options.maxQueueCapacity ?? 1000;
    this.executor = options.executor;
    this.backpressurePolicy = options.backpressurePolicy ?? 'REJECT_IMMEDIATE';
  }

  /**
   * Enqueues a payload for micro-batch execution and returns a promise for the result.
   */
  public enqueue(
    payload: TPayload,
    priority: PriorityLevel = 'STANDARD',
    customSlaMs?: number
  ): Promise<TResult> {
    if (this.isShutdown) {
      return Promise.reject(new Error(`Batcher '${this.name}' has been shut down`));
    }

    const now = Date.now();
    this.updateArrivalRate(now);

    // Handle backpressure if capacity reached
    if (this.queue.length >= this.maxQueueCapacity) {
      if (this.backpressurePolicy === 'REJECT_IMMEDIATE') {
        return Promise.reject(new Error(`Queue capacity exceeded (${this.maxQueueCapacity})`));
      } else if (this.backpressurePolicy === 'DROP_LOWEST_PRIORITY') {
        const dropped = this.dropLowestPriorityItem();
        if (!dropped) {
          return Promise.reject(new Error(`Queue full of higher priority items`));
        }
      }
    }

    const slaMs = customSlaMs ?? this.defaultSlaMs;
    const slaDeadlineMs = now + slaMs;

    return new Promise<TResult>((resolve, reject) => {
      const item: BatchItem<TPayload, TResult> = {
        id: `req-${this.totalEnqueued + 1}-${Math.random().toString(36).substring(2, 7)}`,
        payload,
        priority,
        slaDeadlineMs,
        enqueuedAt: now,
        resolve,
        reject,
      };

      this.queue.push(item);
      this.totalEnqueued++;

      // Check if immediate flush condition is met
      const currentTarget = this.computeAdaptiveBatchSize();
      if (this.queue.length >= currentTarget) {
        this.triggerImmediateFlush();
      } else {
        this.scheduleNextFlush();
      }
    });
  }

  /**
   * Immediately flushes all queued items into one or more batches.
   */
  public async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.queue.length > 0) {
      await this.processNextBatch();
    }
  }

  /**
   * Gracefully shuts down the batcher, flushing remaining items and releasing resources.
   */
  public async shutdown(): Promise<void> {
    this.isShutdown = true;
    await this.flush();
  }

  /**
   * Returns current telemetry and SLA performance metrics.
   */
  public getMetrics(): BatcherMetrics {
    const avgBatch = this.totalFlushes > 0 ? this.totalProcessed / this.totalFlushes : 0;
    const avgLatency = this.totalProcessed > 0 ? this.totalLatencyAccumulator / this.totalProcessed : 0;
    const arrivalRate = this.smoothedIntervalMs > 0 ? 1000 / this.smoothedIntervalMs : 0;

    return {
      name: this.name,
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalFlushes: this.totalFlushes,
      slaBreachCount: this.slaBreachCount,
      averageBatchSize: Number(avgBatch.toFixed(2)),
      averageLatencyMs: Number(avgLatency.toFixed(2)),
      currentQueueDepth: this.queue.length,
      estimatedArrivalRatePerSec: Number(arrivalRate.toFixed(1)),
    };
  }

  // --- Internal Scheduling & Adaptive Mechanics ---

  private updateArrivalRate(now: number): void {
    if (this.lastEnqueueTime > 0) {
      const delta = Math.max(1, now - this.lastEnqueueTime);
      this.smoothedIntervalMs =
        this.ewmaAlpha * delta + (1 - this.ewmaAlpha) * this.smoothedIntervalMs;
    }
    this.lastEnqueueTime = now;
  }

  /**
   * Adapts target batch size based on incoming request arrival velocity.
   */
  public computeAdaptiveBatchSize(): number {
    // Arrival rate in requests per second
    const reqPerSec = 1000 / Math.max(1, this.smoothedIntervalMs);

    if (reqPerSec < 10) {
      // Low traffic: dispatch fast to minimize latency
      return this.minBatchSize;
    } else if (reqPerSec > 200) {
      // High burst: accumulate up to maxBatchSize for throughput
      return this.maxBatchSize;
    } else {
      // Linear interpolation between min and max batch size
      const ratio = (reqPerSec - 10) / 190;
      return Math.round(this.minBatchSize + ratio * (this.maxBatchSize - this.minBatchSize));
    }
  }

  private scheduleNextFlush(): void {
    if (this.flushTimer || this.queue.length === 0) return;

    const now = Date.now();
    // Find the earliest SLA deadline among queued items
    let earliestDeadline = Infinity;
    for (const item of this.queue) {
      if (item.slaDeadlineMs < earliestDeadline) {
        earliestDeadline = item.slaDeadlineMs;
      }
    }

    const timeToEarliestDeadline = Math.max(0, earliestDeadline - now);
    const delay = Math.min(this.maxWaitMs, timeToEarliestDeadline);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.triggerImmediateFlush();
    }, delay);
  }

  private triggerImmediateFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.processNextBatch().catch(() => {});
  }

  private async processNextBatch(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    try {
      // Sort queue by priority first, then by enqueued timestamp (FIFO within same priority)
      this.queue.sort((a, b) => {
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.enqueuedAt - b.enqueuedAt;
      });

      // Extract batch
      const batchSize = Math.min(this.queue.length, this.maxBatchSize);
      const batch = this.queue.splice(0, batchSize);

      if (batch.length === 0) return;

      const now = Date.now();
      const payloads = batch.map((item) => item.payload);

      // Check for SLA breaches
      for (const item of batch) {
        const latency = now - item.enqueuedAt;
        this.totalLatencyAccumulator += latency;
        if (now > item.slaDeadlineMs) {
          this.slaBreachCount++;
        }
      }

      this.totalFlushes++;
      this.totalProcessed += batch.length;

      try {
        const results = await this.executor(payloads);
        for (let i = 0; i < batch.length; i++) {
          batch[i].resolve(results[i]);
        }
      } catch (err) {
        for (const item of batch) {
          item.reject(err);
        }
      }
    } finally {
      this.isFlushing = false;
      if (this.queue.length > 0) {
        this.scheduleNextFlush();
      }
    }
  }

  private dropLowestPriorityItem(): boolean {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].priority === 'BACKGROUND') {
        const [dropped] = this.queue.splice(i, 1);
        dropped.reject(new Error('Request dropped due to queue congestion (BACKGROUND)'));
        return true;
      }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].priority === 'STANDARD') {
        const [dropped] = this.queue.splice(i, 1);
        dropped.reject(new Error('Request dropped due to queue congestion (STANDARD)'));
        return true;
      }
    }
    return false;
  }
}
