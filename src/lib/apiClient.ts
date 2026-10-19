export interface ApiClientOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Parses the Retry-After header which can be either an integer number of seconds
 * or an HTTP-date string. Returns delay in milliseconds.
 */
export function parseRetryAfterHeader(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) return 1000; // Default fallback delay

  // 1. Try parsing as integer seconds
  const seconds = parseInt(retryAfterHeader, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // 2. Try parsing as HTTP-date string
  const parsedDate = Date.parse(retryAfterHeader);
  if (!isNaN(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    return Math.max(0, deltaMs);
  }

  return 1000; // Fallback
}

/**
 * Enhanced unified client fetch wrapper with HTTP 429 Retry-After handling,
 * exponential backoff, jitter, and maximum 3 retries.
 */
export async function apiClient<T = any>(
  url: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, options);

      // Inspect HTTP 429 Too Many Requests
      if (response.status === 429 && attempt < maxRetries) {
        attempt++;
        const retryAfterHeader = response.headers.get('Retry-After');
        const parsedRetryAfterMs = parseRetryAfterHeader(retryAfterHeader);

        // Calculate exponential backoff with jitter
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 300; // Add up to 300ms random jitter
        const delay = Math.max(parsedRetryAfterMs, exponentialDelay) + jitter;

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`API Request failed with status ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      return (await response.text()) as unknown as T;
    } catch (error: any) {
      if (attempt >= maxRetries) {
        throw error;
      }
      attempt++;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export default apiClient;

// ---------------------------------------------------------------------------
// apiFetch — rate-limit aware fetch wrapper (see docs/API_CLIENT_WRAPPER.md)
//
// This export (and the quota store below) had been dropped from this module
// while EnhancedChatbot, the reservation client, RateLimitBanner and
// useRateLimit still import it, which broke those modules at runtime.
// ---------------------------------------------------------------------------

export type RateLimitEndpoint = "chat" | "book" | "other";

export interface RateLimitEventDetail {
  /** Seconds until requests are accepted again. */
  retryAfter: number;
  endpoint: RateLimitEndpoint;
  /** "chat", "book" or the request pathname. */
  bucket: string;
  /** Epoch ms when requests are accepted again. */
  retryAt: number;
  /** True when apiFetch will re-send the request automatically. */
  willRetry: boolean;
}

export interface RateLimitQuota {
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the window resets, if known. */
  resetAt: number | null;
  /** Epoch ms until which the bucket is blocked after a 429, if any. */
  retryAt: number | null;
  updatedAt: number;
}

export interface RetryOnRateLimitOptions {
  maxRetries?: number;
  maxWaitSeconds?: number;
}

export interface ApiFetchOptions {
  retryOnRateLimit?: boolean | RetryOnRateLimitOptions;
}

const quotas = new Map<string, RateLimitQuota>();
const quotaListeners = new Set<() => void>();

export function getRateLimitQuota(bucket: string): RateLimitQuota | undefined {
  return quotas.get(bucket);
}

export function subscribeRateLimitQuota(listener: () => void): () => void {
  quotaListeners.add(listener);
  return () => {
    quotaListeners.delete(listener);
  };
}

function setQuota(bucket: string, quota: RateLimitQuota): void {
  // Replace the object so useSyncExternalStore sees a new snapshot.
  quotas.set(bucket, quota);
  quotaListeners.forEach((l) => l());
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function pathnameOf(url: string): string {
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return new URL(url, base).pathname;
  } catch {
    return url.split("?")[0].split("#")[0];
  }
}

/** Classifies a request by its path only (query string ignored). */
export function classifyEndpoint(url: string): {
  endpoint: RateLimitEndpoint;
  bucket: string;
} {
  const path = pathnameOf(url);
  if (/\/book|\/confirm|\/reservations/.test(path)) {
    return { endpoint: "book", bucket: "book" };
  }
  if (path === "/api/chat" || path.startsWith("/api/chat/")) {
    return { endpoint: "chat", bucket: "chat" };
  }
  return { endpoint: "other", bucket: path };
}

function parseNumberHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Interprets an X-RateLimit-Reset / RateLimit-Reset value, which may be a
 * delta in seconds, a Unix timestamp in seconds, or one in milliseconds.
 * Returns epoch ms, or null.
 */
export function parseResetHeader(value: string | null, now = Date.now()): number | null {
  const n = parseNumberHeader(value);
  if (n === null || n < 0) return null;
  if (n > 1e12) return n; // epoch ms
  if (n > 1e9) return n * 1000; // epoch seconds
  return now + n * 1000; // delta seconds
}

function readHeader(headers: Headers, ...names: string[]): string | null {
  for (const name of names) {
    const v = headers.get(name);
    if (v !== null) return v;
  }
  return null;
}

async function retryAfterSecondsFrom(response: Response, now: number): Promise<number> {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    return Math.max(0, Math.ceil(parseRetryAfterHeader(retryAfter) / 1000));
  }

  const reset = parseResetHeader(
    readHeader(response.headers, "X-RateLimit-Reset", "RateLimit-Reset"),
    now,
  );
  if (reset !== null) return Math.max(0, Math.ceil((reset - now) / 1000));

  try {
    const body = await response.clone().json();
    const value = body?.retryAfter ?? body?.retry_after ?? body?.resetIn;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  } catch {
    // Body is not JSON — fall through to the default.
  }
  return 60;
}

function recordQuota(bucket: string, response: Response, now: number): void {
  const limit = parseNumberHeader(
    readHeader(response.headers, "X-RateLimit-Limit", "RateLimit-Limit"),
  );
  const remaining = parseNumberHeader(
    readHeader(response.headers, "X-RateLimit-Remaining", "RateLimit-Remaining"),
  );
  const resetAt = parseResetHeader(
    readHeader(response.headers, "X-RateLimit-Reset", "RateLimit-Reset"),
    now,
  );
  const previous = quotas.get(bucket);

  if (limit === null && remaining === null && resetAt === null) {
    // No quota headers: only clear a stale 429 block.
    if (previous?.retryAt) setQuota(bucket, { ...previous, retryAt: null, updatedAt: now });
    return;
  }
  setQuota(bucket, { limit, remaining, resetAt, retryAt: null, updatedAt: now });
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * fetch() wrapper that detects HTTP 429, records X-RateLimit-* quota per
 * bucket, broadcasts a `rate-limit-triggered` CustomEvent, and optionally
 * waits out the limit and re-sends. The original Response is returned.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const url = requestUrl(input);
  const { endpoint, bucket } = classifyEndpoint(url);
  const retryConfig =
    options.retryOnRateLimit === true
      ? {}
      : options.retryOnRateLimit || null;
  const maxRetries = retryConfig ? retryConfig.maxRetries ?? 2 : 0;
  const maxWaitSeconds = retryConfig?.maxWaitSeconds ?? 60;
  const signal = init?.signal ?? (input instanceof Request ? input.signal : null);

  for (let attempt = 0; ; attempt++) {
    // A retrying request waits while the bucket is known to be blocked.
    const blockedUntil = quotas.get(bucket)?.retryAt;
    if (retryConfig && blockedUntil && blockedUntil > Date.now()) {
      await wait(blockedUntil - Date.now(), signal);
    }

    const attemptInput = input instanceof Request ? input.clone() : input;
    const response = await fetch(attemptInput, init);
    const now = Date.now();

    if (response.status !== 429) {
      recordQuota(bucket, response, now);
      return response;
    }

    const retryAfter = await retryAfterSecondsFrom(response, now);
    const retryAt = now + retryAfter * 1000;
    const willRetry =
      Boolean(retryConfig) && attempt < maxRetries && retryAfter <= maxWaitSeconds;

    const previous = quotas.get(bucket);
    setQuota(bucket, {
      limit: previous?.limit ?? null,
      remaining: 0,
      resetAt: previous?.resetAt ?? retryAt,
      retryAt,
      updatedAt: now,
    });

    if (typeof window !== "undefined") {
      const detail: RateLimitEventDetail = { retryAfter, endpoint, bucket, retryAt, willRetry };
      window.dispatchEvent(new CustomEvent("rate-limit-triggered", { detail }));
    }

    if (!willRetry) return response;
    await wait(Math.max(0, retryAt - Date.now()), signal);
  }
}
