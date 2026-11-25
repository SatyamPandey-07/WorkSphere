/**
 * retryWithBackoff: resilient retry helper for transient upstream LLM failures (#7945).
 *
 * Retries a failing async call with exponential backoff and randomized jitter.
 * Only transient upstream errors are retried: 429 (rate limited) and
 * 502 / 503 / 504 (gateway and availability errors). Anything else, including
 * 4xx client errors and plain programming errors, is thrown immediately.
 *
 * Delay before retry `n` (1 based):
 *
 *   delay = min(maxDelayMs, baseDelayMs * 2^(n - 1)) + random() * jitterRatio * that value
 *
 * With the defaults (base 500 ms, jitter 25%, 3 attempts) the waits are about
 * 500 to 625 ms and then 1000 to 1250 ms. Jitter is added after the cap, so a
 * wait can exceed `maxDelayMs` by up to `jitterRatio`.
 *
 * When the upstream sends a `Retry-After` header, the wait is raised to that
 * value, but never above `maxDelayMs`.
 */

/** HTTP status codes treated as transient and safe to retry. */
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  429, 502, 503, 504,
]);

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8_000;
export const DEFAULT_JITTER_RATIO = 0.25;

export interface RetryInfo {
  /** The attempt that just failed (1 based). */
  attempt: number;
  /** How long the helper will wait before the next attempt. */
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  /** Total attempts including the first call (default: 3). */
  maxAttempts?: number;
  /** Delay before the first retry in milliseconds (default: 500). */
  baseDelayMs?: number;
  /** Cap on the exponential delay, before jitter, in milliseconds (default: 8000). */
  maxDelayMs?: number;
  /** Extra random delay as a fraction of the exponential delay, 0 to 1 (default: 0.25). */
  jitterRatio?: number;
  /** Decides whether an error is worth retrying (default: isRetryableLlmError). */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each wait, for logging or metrics. */
  onRetry?: (info: RetryInfo) => void;
  /** Random source returning a value in [0, 1). Injectable for deterministic tests. */
  random?: () => number;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Reads an HTTP status from the shapes common SDKs and fetch wrappers use. */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  return (
    readNumber(candidate.status) ??
    readNumber(candidate.statusCode) ??
    readNumber(candidate.response?.status)
  );
}

/** True for 429, 502, 503 and 504 errors. */
export function isRetryableLlmError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status !== undefined && RETRYABLE_STATUS_CODES.has(status);
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value = (getter as (key: string) => unknown).call(headers, name);
    return typeof value === "string" ? value : undefined;
  }
  const record = headers as Record<string, unknown>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key ? record[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

/**
 * Parses a `Retry-After` header (seconds or an HTTP date) from the error's
 * headers into milliseconds. Returns undefined when absent or unparseable.
 */
export function getRetryAfterMs(
  error: unknown,
  now: number = Date.now(),
): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const raw = readHeader(
    (error as { headers?: unknown }).headers,
    "retry-after",
  )?.trim();
  if (!raw) return undefined;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.round(Number(raw) * 1000);
  }
  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - now);
}

function sanitize(
  value: number | undefined,
  fallback: number,
  min: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min
    ? value
    : fallback;
}

/**
 * Delay in milliseconds before retry number `retryNumber` (1 for the first retry).
 */
export function computeBackoffDelay(
  retryNumber: number,
  options: Pick<
    RetryOptions,
    "baseDelayMs" | "maxDelayMs" | "jitterRatio" | "random"
  > = {},
): number {
  const baseDelayMs = sanitize(options.baseDelayMs, DEFAULT_BASE_DELAY_MS, 0);
  const maxDelayMs = sanitize(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, 0);
  const jitterRatio = Math.min(
    1,
    sanitize(options.jitterRatio, DEFAULT_JITTER_RATIO, 0),
  );
  const random = options.random ?? Math.random;

  const exponent = Math.max(0, Math.floor(retryNumber) - 1);
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
  const jitter = Math.min(1, Math.max(0, random())) * jitterRatio * exponential;
  return Math.round(exponential + jitter);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying transient failures with exponential backoff and jitter.
 * Resolves with the first successful result. Rejects with the last error once
 * attempts run out, or immediately for an error that is not retryable.
 *
 * @param fn Receives the 1 based attempt number.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(
    1,
    Math.floor(sanitize(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1)),
  );
  const maxDelayMs = sanitize(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, 0);
  const isRetryable = options.isRetryable ?? isRetryableLlmError;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      let delayMs = computeBackoffDelay(attempt, options);
      const retryAfterMs = getRetryAfterMs(error);
      if (retryAfterMs !== undefined) {
        delayMs = Math.max(delayMs, Math.min(retryAfterMs, maxDelayMs));
      }

      options.onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }
}
