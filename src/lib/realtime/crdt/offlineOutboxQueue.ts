import {
  compareVectorClocks,
  type CrdtMutation,
} from '@/lib/realtime/crdt/roomStateReconciler';

export const DEFAULT_OUTBOX_MAX_SIZE = 200;

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface OfflineOutboxOptions<TPayload = unknown> {
  storageKey?: string;
  maxSize?: number;
  storage?: StorageLike | null;
  initialEntries?: CrdtMutation<TPayload>[];
}

export class OfflineOutboxQueue<TPayload = unknown> {
  private readonly storageKey: string;
  private readonly maxSize: number;
  private readonly storage: StorageLike | null;
  private queue: CrdtMutation<TPayload>[] = [];

  constructor(options: OfflineOutboxOptions<TPayload> = {}) {
    this.storageKey = options.storageKey ?? 'worksphere:crdt_outbox:v1';
    this.maxSize = Math.max(
      1,
      Math.floor(options.maxSize ?? DEFAULT_OUTBOX_MAX_SIZE)
    );
    this.storage =
      options.storage !== undefined
        ? options.storage
        : typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : null;

    if (options.initialEntries && options.initialEntries.length > 0) {
      this.queue = options.initialEntries.slice(-this.maxSize);
      this.persist();
    } else {
      this.hydrate();
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.queue = parsed.slice(-this.maxSize);
      }
    } catch {
      this.queue = [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.queue));
    } catch {
      // Ignore storage quota or serialization errors
    }
  }

  public enqueue(mutation: CrdtMutation<TPayload>): number {
    this.queue.push(mutation);
    if (this.queue.length > this.maxSize) {
      this.queue = this.queue.slice(this.queue.length - this.maxSize);
    }
    this.persist();
    return this.queue.length;
  }

  public compact(): CrdtMutation<TPayload>[] {
    const compacted: CrdtMutation<TPayload>[] = [];

    for (const item of this.queue) {
      let superseded = false;
      for (let i = compacted.length - 1; i >= 0; i -= 1) {
        const existing = compacted[i];
        if (existing.elementId !== item.elementId) continue;

        const rel = compareVectorClocks(existing.vectorClock, item.vectorClock);
        if (rel === 'before') {
          compacted.splice(i, 1);
        } else if (rel === 'after' || rel === 'equal') {
          superseded = true;
          break;
        }
      }

      if (!superseded) {
        compacted.push(item);
      }
    }

    this.queue = compacted.slice(-this.maxSize);
    this.persist();
    return [...this.queue];
  }

  public peekAll(): CrdtMutation<TPayload>[] {
    return [...this.queue];
  }

  public size(): number {
    return this.queue.length;
  }

  public async flush(
    sender: (batch: CrdtMutation<TPayload>[]) => Promise<void> | void
  ): Promise<number> {
    const batch = this.compact();
    if (batch.length === 0) return 0;

    await sender(batch);
    this.queue = [];
    this.persist();
    return batch.length;
  }

  public clear(): void {
    this.queue = [];
    this.persist();
  }
}
