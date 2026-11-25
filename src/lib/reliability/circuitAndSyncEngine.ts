export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxSuccesses?: number;
  nowFn?: () => number;
}

export class CircuitOpenError extends Error {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message?: string) {
    super(
      message ??
        `Service circuit open. Retry after ${Math.max(0, retryAfterMs)}ms.`
    );
    this.name = 'CircuitOpenError';
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

export class ResilienceCircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAtMs = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxSuccesses: number;
  private readonly nowFn: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.resetTimeoutMs = Math.max(100, options.resetTimeoutMs ?? 15_000);
    this.halfOpenMaxSuccesses = Math.max(1, options.halfOpenMaxSuccesses ?? 2);
    this.nowFn = options.nowFn ?? Date.now;
  }

  public getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = this.nowFn() - this.openedAtMs;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenSuccesses = 0;
      }
    }
    return this.state;
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === 'open') {
      const remaining = Math.max(
        0,
        this.resetTimeoutMs - (this.nowFn() - this.openedAtMs)
      );
      throw new CircuitOpenError(remaining);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenMaxSuccesses) {
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    this.halfOpenSuccesses = 0;
    if (
      this.state === 'half_open' ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = 'open';
      this.openedAtMs = this.nowFn();
    }
  }
}

export interface SyncEventRecord<TPayload = unknown> {
  id: string;
  key: string;
  payload: TPayload;
  version: number;
  peerId: string;
  timestampMs: number;
}

export function compareSyncEvents<TPayload>(
  a: SyncEventRecord<TPayload>,
  b: SyncEventRecord<TPayload>
): number {
  if (a.version !== b.version) {
    return a.version - b.version;
  }
  if (a.timestampMs !== b.timestampMs) {
    return a.timestampMs - b.timestampMs;
  }
  return a.peerId.localeCompare(b.peerId);
}

export class BoundedSyncOutbox<TPayload = unknown> {
  private readonly maxItems: number;
  private items: SyncEventRecord<TPayload>[] = [];

  constructor(maxItems = 250) {
    this.maxItems = Math.max(1, maxItems);
  }

  public push(event: SyncEventRecord<TPayload>): void {
    this.items.push(event);
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(this.items.length - this.maxItems);
    }
  }

  public compact(): SyncEventRecord<TPayload>[] {
    const latestByKey = new Map<string, SyncEventRecord<TPayload>>();
    for (const entry of this.items) {
      const existing = latestByKey.get(entry.key);
      if (!existing || compareSyncEvents(entry, existing) >= 0) {
        latestByKey.set(entry.key, entry);
      }
    }
    this.items = Array.from(latestByKey.values());
    return [...this.items];
  }

  public size(): number {
    return this.items.length;
  }

  public async drain(
    handler: (batch: SyncEventRecord<TPayload>[]) => Promise<void> | void
  ): Promise<number> {
    const batch = this.compact();
    if (batch.length === 0) return 0;
    await handler(batch);
    this.items = [];
    return batch.length;
  }
}

export function calculateJitterMs(pingSamples: readonly number[]): number {
  const valid = pingSamples.filter(
    (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  );
  if (valid.length < 2) return 0;

  let deltaSum = 0;
  for (let i = 1; i < valid.length; i += 1) {
    deltaSum += Math.abs(valid[i] - valid[i - 1]);
  }
  return Math.round((deltaSum / (valid.length - 1)) * 10) / 10;
}

export function clampBaselineRatioPercent(
  actual: number,
  baseline: number
): { rawPercent: number; clampedPercent: number; overagePercent: number } {
  const safeActual = Number.isFinite(actual) ? Math.max(0, actual) : 0;
  const safeBaseline =
    Number.isFinite(baseline) && baseline > 0 ? baseline : 1;
  const rawPercent = Math.round((safeActual / safeBaseline) * 1000) / 10;
  const clampedPercent = Math.min(100, Math.max(0, rawPercent));
  const overagePercent = Math.max(0, Math.round(rawPercent - 100));
  return { rawPercent, clampedPercent, overagePercent };
}
