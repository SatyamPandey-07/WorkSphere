export type MutationStatus = 'PENDING' | 'IN_FLIGHT' | 'FAILED';

export interface MutationErrorLike {
  status?: number;
  statusCode?: number;
  nonRetriable?: boolean;
  message?: string;
}

export interface QueuedMutation<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  orderKey: number;
  enqueuedAt: number;
  seq: number;
  attempts: number;
  maxRetries: number;
  status: MutationStatus;
  lastError?: string;
}

export interface EnqueueMutationInput<TPayload = unknown> {
  id?: string;
  type: string;
  payload: TPayload;
  orderKey?: number;
  maxRetries?: number;
  now?: number;
}

export type MutationExecutor<TPayload = unknown> = (
  mutation: QueuedMutation<TPayload>
) => Promise<void>;

export interface DrainSummary {
  succeeded: string[];
  requeued: string[];
  failed: string[];
}

export interface QueueSnapshot<TPayload = unknown> {
  pendingCount: number;
  failedCount: number;
  items: Array<QueuedMutation<TPayload>>;
}

let idCounter = 0;

function nextMutationId(): string {
  idCounter += 1;
  return `mut_${Date.now()}_${idCounter}`;
}

export function isNonRetriableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as MutationErrorLike;
  if (candidate.nonRetriable === true) return true;
  const code = candidate.status ?? candidate.statusCode;
  if (typeof code === 'number' && code >= 400 && code < 500) {
    return code !== 408 && code !== 429;
  }
  return false;
}

export class OfflineMutationQueue<TPayload = unknown> {
  private readonly items = new Map<string, QueuedMutation<TPayload>>();
  private seqCounter = 0;
  private readonly defaultMaxRetries: number;

  constructor(options: { defaultMaxRetries?: number } = {}) {
    this.defaultMaxRetries = Math.max(1, options.defaultMaxRetries ?? 3);
  }

  enqueue(input: EnqueueMutationInput<TPayload>): QueuedMutation<TPayload> {
    const now = input.now ?? Date.now();
    this.seqCounter += 1;
    const id = input.id?.trim() || nextMutationId();

    const entry: QueuedMutation<TPayload> = {
      id,
      type: input.type,
      payload: input.payload,
      orderKey: input.orderKey ?? now,
      enqueuedAt: now,
      seq: this.seqCounter,
      attempts: 0,
      maxRetries: Math.max(1, input.maxRetries ?? this.defaultMaxRetries),
      status: 'PENDING',
    };

    this.items.set(id, { ...entry });
    return { ...entry };
  }

  private getOrderedPending(): QueuedMutation<TPayload>[] {
    return Array.from(this.items.values())
      .filter((item) => item.status === 'PENDING')
      .sort((a, b) => {
        if (a.orderKey !== b.orderKey) return a.orderKey - b.orderKey;
        if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
        return a.seq - b.seq;
      });
  }

  async drain(executor: MutationExecutor<TPayload>): Promise<DrainSummary> {
    const succeeded: string[] = [];
    const requeued: string[] = [];
    const failed: string[] = [];

    const pendingBatch = this.getOrderedPending();

    for (const item of pendingBatch) {
      const current = this.items.get(item.id);
      if (!current || current.status !== 'PENDING') continue;

      current.status = 'IN_FLIGHT';
      this.items.set(current.id, current);

      try {
        await executor({ ...current });
        this.items.delete(current.id);
        succeeded.push(current.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        current.attempts += 1;
        current.lastError = message;

        if (isNonRetriableError(err) || current.attempts >= current.maxRetries) {
          current.status = 'FAILED';
          this.items.set(current.id, current);
          failed.push(current.id);
        } else {
          current.status = 'PENDING';
          this.items.set(current.id, current);
          requeued.push(current.id);
        }
      }
    }

    return { succeeded, requeued, failed };
  }

  retryFailed(id?: string): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status !== 'FAILED') continue;
      if (id && item.id !== id) continue;
      item.status = 'PENDING';
      item.attempts = 0;
      delete item.lastError;
      this.items.set(item.id, item);
      count += 1;
    }
    return count;
  }

  discard(id: string): boolean {
    return this.items.delete(id);
  }

  getSnapshot(): QueueSnapshot<TPayload> {
    const all = Array.from(this.items.values()).sort((a, b) => a.seq - b.seq);
    let pendingCount = 0;
    let failedCount = 0;
    for (const item of all) {
      if (item.status === 'PENDING' || item.status === 'IN_FLIGHT') pendingCount += 1;
      if (item.status === 'FAILED') failedCount += 1;
    }
    return {
      pendingCount,
      failedCount,
      items: all.map((x) => ({ ...x })),
    };
  }
}