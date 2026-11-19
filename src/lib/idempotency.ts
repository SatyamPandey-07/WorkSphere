import { createHash } from "crypto";

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
  complete(
    key: string,
    status: number,
    body: unknown,
    expiresAt: number,
  ): Promise<void>;
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

  async complete(
    key: string,
    status: number,
    body: unknown,
    expiresAt: number,
  ): Promise<void> {
    const current = this.records.get(key);
    if (!current) return;
    this.records.set(key, {
      ...current,
      status,
      body,
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }
}

export function hashIdempotencyPayload(payload: unknown): string {
  const serialized =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

export interface RunWithIdempotencyOptions<T> {
  key: string;
  payload: unknown;
  store: IdempotencyStore;
  ttlMs?: number;
  handler: () => Promise<{ status: number; body: T }>;
}

export interface RunWithIdempotencyResult<T> {
  status: number;
  body: T | { error: string };
  replayed: boolean;
}

export async function runWithIdempotency<T>(
  options: RunWithIdempotencyOptions<T>,
): Promise<RunWithIdempotencyResult<T>> {
  const { key, payload, store, ttlMs = 24 * 60 * 60 * 1000, handler } = options;
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return {
      status: 400,
      body: { error: "Idempotency-Key header is required" },
      replayed: false,
    };
  }

  const currentPayloadHash = hashIdempotencyPayload(payload);
  const existing = await store.get(normalizedKey);

  if (existing) {
    if (existing.requestHash !== currentPayloadHash) {
      return {
        status: 409,
        body: {
          error: "Idempotency key reused with different request payload",
        },
        replayed: false,
      };
    }

    if (existing.status !== 0) {
      return {
        status: existing.status,
        body: existing.body as T,
        replayed: true,
      };
    }
  }

  const locked = await store.setIfAbsent({
    key: normalizedKey,
    requestHash: currentPayloadHash,
    status: 0,
    body: null,
    expiresAt: Date.now() + ttlMs,
  });

  if (!locked) {
    const latest = await store.get(normalizedKey);
    if (
      latest &&
      latest.requestHash === currentPayloadHash &&
      latest.status !== 0
    ) {
      return {
        status: latest.status,
        body: latest.body as T,
        replayed: true,
      };
    }
    return {
      status: 409,
      body: {
        error: "Concurrent request in progress for this idempotency key",
      },
      replayed: false,
    };
  }

  try {
    const result = await handler();
    await store.complete(
      normalizedKey,
      result.status,
      result.body,
      Date.now() + ttlMs,
    );
    return { status: result.status, body: result.body, replayed: false };
  } catch (err) {
    await store.delete(normalizedKey);
    throw err;
  }
}

export const defaultStore = new MemoryIdempotencyStore();

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedHttpResponse {
  status: number;
  body: unknown;
}

interface IdempotencyEntry {
  requestHash: string;
  expiresAt: number;
  response?: CachedHttpResponse;
  inFlight?: Promise<CachedHttpResponse>;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();

export function computePayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

export class IdempotencyConflictError extends Error {
  constructor(
    message = "Idempotency key reused with a different request payload",
  ) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export async function executeIdempotent(
  key: string,
  payload: unknown,
  handler: () => Promise<CachedHttpResponse>,
): Promise<{ response: CachedHttpResponse; cacheHit: boolean }> {
  const now = Date.now();
  const requestHash = computePayloadHash(payload);
  const existing = idempotencyStore.get(key);

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }

    if (existing.response) {
      return { response: existing.response, cacheHit: true };
    }

    if (existing.inFlight) {
      const response = await existing.inFlight;
      return { response, cacheHit: true };
    }
  }

  const entry: IdempotencyEntry = {
    requestHash,
    expiresAt: now + IDEMPOTENCY_TTL_MS,
  };

  const executionPromise = handler()
    .then((res) => {
      entry.response = res;
      entry.inFlight = undefined;
      return res;
    })
    .catch((err) => {
      idempotencyStore.delete(key);
      throw err;
    });

  entry.inFlight = executionPromise;
  idempotencyStore.set(key, entry);

  const response = await executionPromise;
  return { response, cacheHit: false };
}

export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
}
