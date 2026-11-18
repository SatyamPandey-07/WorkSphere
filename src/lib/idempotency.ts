import crypto from "crypto";

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
  return crypto.createHash("sha256").update(serialized).digest("hex");
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
