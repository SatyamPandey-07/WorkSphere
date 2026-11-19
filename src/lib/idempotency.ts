import { createHash } from 'crypto';

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  setIfAbsent(record: IdempotencyRecord): Promise<boolean>;
  complete(key: string, status: number, body: unknown, expiresAt: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  private purgeIfExpired(key: string): IdempotencyRecord | null {
    const existing = this.records.get(key);
    if (!existing) return null;
    if (Date.now() >= existing.expiresAt) {
      this.records.delete(key);
      return null;
    }
    return existing;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.purgeIfExpired(key);
  }

  async setIfAbsent(record: IdempotencyRecord): Promise<boolean> {
    this.purgeIfExpired(record.key);
    if (this.records.has(record.key)) {
      return false;
    }
    this.records.set(record.key, record);
    return true;
  }

  async complete(key: string, status: number, body: unknown, expiresAt: number): Promise<void> {
    const current = this.records.get(key);
    if (!current) return;
    this.records.set(key, { ...current, status, body, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export interface IdempotencyExecutionResult<T = unknown> {
  status: number;
  body: T;
  replayed: boolean;
}

export async function runWithIdempotency<T>(options: {
  key: string | null | undefined;
  payload: unknown;
  store?: IdempotencyStore;
  ttlMs?: number;
  handler: () => Promise<{ status: number; body: T }>;
}): Promise<IdempotencyExecutionResult<T>> {
  const {
    key,
    payload,
    store = defaultStore,
    ttlMs = 24 * 60 * 60 * 1000,
    handler,
  } = options;

  if (!key || !key.trim()) {
    const res = await handler();
    return { status: res.status, body: res.body, replayed: false };
  }

  const normalizedKey = key.trim();
  const requestHash = hashPayload(payload);
  const now = Date.now();
  const expiresAt = now + ttlMs;

  const acquired = await store.setIfAbsent({
    key: normalizedKey,
    requestHash,
    status: 202,
    body: { status: 'IN_PROGRESS' },
    expiresAt,
  });

  if (!acquired) {
    const existing = await store.get(normalizedKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return {
          status: 409,
          body: { error: 'Idempotency-Key reused with a different request payload' } as unknown as T,
          replayed: false,
        };
      }
      return {
        status: existing.status,
        body: existing.body as T,
        replayed: true,
      };
    }
  }

  try {
    const result = await handler();
    await store.complete(normalizedKey, result.status, result.body, Date.now() + ttlMs);
    return { status: result.status, body: result.body, replayed: false };
  } catch (err) {
    await store.delete(normalizedKey);
    throw err;
  }
}

const defaultStore = new MemoryIdempotencyStore();