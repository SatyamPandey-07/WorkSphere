import { CSRF_HEADER_NAME, CSRF_PROTECTED_METHODS } from "./csrf";
import type { ApiErrorBody } from "./apiResponse";

/** Unified error shape returned by every venue sub-route (see apiResponse.ts). */
export type ApiFailure = ApiErrorBody & { status: number };

/** Narrows an unknown JSON payload to the shared error envelope. */
export function isApiFailure(data: unknown): data is ApiErrorBody {
  if (typeof data !== "object" || data === null) return false;
  const v = data as Record<string, unknown>;
  return v.success === false && typeof v.error === "string";
}

/**
 * Single-flight token refresh guard.
 *
 * When multiple concurrent requests receive a 401 during Clerk JWT expiration,
 * naively each one triggers a token refresh — causing a queue of parallel
 * refreshes that can race and deadlock when one fails while others are waiting.
 *
 * This module ensures only ONE refresh is in-flight at a time. All requests
 * that arrive while a refresh is pending queue on the same promise rather than
 * starting a competing refresh.
 *
 * Usage:
 *   const token = await getValidToken(clerk.session);
 */
let _refreshPromise: Promise<string | null> | null = null;

export async function getValidToken(
  session: { getToken: () => Promise<string | null> } | null | undefined,
): Promise<string | null> {
  if (!session) return null;

  if (_refreshPromise) {
    // Another request is already refreshing — queue on the same promise.
    return _refreshPromise;
  }

  _refreshPromise = session.getToken().finally(() => {
    _refreshPromise = null;
  });

  return _refreshPromise;
}

/** Cached CSRF token; refreshed proactively before mutations and on 403 rejection. */
let _csrfToken: string | null = null;

/** Timestamp (ms) of the last successful CSRF token fetch. */
let _csrfFetchedAt = 0;

/**
 * If the cached token is older than this threshold, treat it as near-expiration
 * and proactively refresh before issuing a mutation request. 20 minutes is
 * well within any realistic session/cookie lifetime while avoiding unnecessary
 * round-trips on rapid successive mutations.
 */
export const CSRF_REFRESH_THRESHOLD_MS = 20 * 60 * 1000;

/** Single-flight guard for CSRF token refresh — mirrors the pattern used by getValidToken above. */
let _csrfRefreshPromise: Promise<string | null> | null = null;

/**
 * Fetch a fresh CSRF token from /api/auth/csrf-token.
 * Always hits the server; callers should use ensureCsrfToken() to avoid redundant requests.
 */
async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.csrfToken && typeof data.csrfToken === "string") {
      _csrfToken = data.csrfToken;
      _csrfFetchedAt = Date.now();
      return _csrfToken;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the age (in ms) of the cached CSRF token.
 * Returns Infinity if no token is currently cached.
 */
export function getCsrfTokenAge(): number {
  if (!_csrfToken || !_csrfFetchedAt) return Infinity;
  return Date.now() - _csrfFetchedAt;
}

/**
 * Checks whether the CSRF token is missing or near expiration.
 */
export function isCsrfTokenNearExpiration(): boolean {
  if (!_csrfToken) return true;
  return getCsrfTokenAge() >= CSRF_REFRESH_THRESHOLD_MS;
}

/**
 * Ensures a valid, non-stale CSRF token is available for a mutation request.
 *
 * Behaviour:
 *  - Returns the cached token immediately if it was fetched recently (< threshold).
 *  - Otherwise fetches a fresh token from the server, using single-flight
 *    deduplication so concurrent mutations share the same in-flight refresh.
 */
export async function ensureCsrfToken(): Promise<string | null> {
  if (!isCsrfTokenNearExpiration() && _csrfToken) {
    return _csrfToken;
  }

  // Single-flight: if another caller is already fetching, queue on that promise.
  if (_csrfRefreshPromise) {
    return _csrfRefreshPromise;
  }

  _csrfRefreshPromise = fetchCsrfToken().finally(() => {
    _csrfRefreshPromise = null;
  });

  return _csrfRefreshPromise;
}

function isMutatingMethod(method: string): boolean {
  return CSRF_PROTECTED_METHODS.has(method.toUpperCase());
}

/** Resolve the effective HTTP method from RequestInit / Request input. */
function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

let _sessionRefreshPromise: Promise<boolean> | null = null;

/**
 * Silently rotates and refreshes the session token via /api/auth/session/refresh.
 * Single-flight guard prevents redundant simultaneous refresh calls.
 */
export async function refreshSessionToken(): Promise<boolean> {
  if (_sessionRefreshPromise) {
    return _sessionRefreshPromise;
  }

  _sessionRefreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/session/refresh", {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    }
  })().finally(() => {
    _sessionRefreshPromise = null;
  });

  return _sessionRefreshPromise;
}

async function sendWithCsrf(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = resolveMethod(input, init);
  const urlString =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof Request !== "undefined" && input instanceof Request
          ? input.url
          : "";

  // Proactively ensure a fresh CSRF token and attach it before mutation requests.
  if (isMutatingMethod(method) && !urlString.includes("/api/auth/csrf-token")) {
    const token = await ensureCsrfToken();
    if (token) {
      const existingHeaders =
        init?.headers ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined);
      const headers = new Headers(existingHeaders);
      headers.set(CSRF_HEADER_NAME, token);
      init = { ...init, method, headers };
    }
  }

  const response = await fetch(input, init);

  // Auto-refresh CSRF token and retry once on 403 with CSRF rejection code.
  // This handles sessions left open >24 hours where the cookie expired.
  if (response.status === 403) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (
        data?.code === "CSRF_INVALID" ||
        (typeof data?.error === "string" &&
          data.error.toLowerCase().includes("csrf"))
      ) {
        const freshToken = await fetchCsrfToken();
        if (freshToken) {
          const retryHeaders = new Headers(
            init?.headers instanceof Headers
              ? init.headers
              : new Headers(init?.headers ?? {}),
          );
          retryHeaders.set(CSRF_HEADER_NAME, freshToken);
          return fetch(input, { ...init, method, headers: retryHeaders });
        }
      }
    } catch {
      // If JSON parse fails or retry fetch fails, fall through to return original 403
    }
  }

  // Silent session refresh and retry on 401 Unauthorized
  if (
    response.status === 401 &&
    !urlString.includes("/api/auth/session/refresh") &&
    !urlString.includes("/sign-in")
  ) {
    try {
      const refreshed = await refreshSessionToken();
      if (refreshed) {
        return fetch(input, init);
      }
    } catch {
      // Fall through to original 401 response
    }
  }

  return response;
}

// ─── Rate-limit quota tracking & automatic retry (#1454, #1732) ─────────────

/** Coarse endpoint groups used by useRateLimit("chat" | "book") consumers. */
export type RateLimitEndpoint = "chat" | "book" | "other";

export interface RateLimitQuota {
  /** "chat", "book", or the request pathname for any other endpoint. */
  bucket: string;
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the quota window resets, if the server said so. */
  resetAt: number | null;
  /** Epoch ms before which requests will be rejected (set on 429). */
  retryAt: number | null;
}

export interface RateLimitEventDetail {
  retryAfter: number;
  endpoint: RateLimitEndpoint;
  bucket: string;
  retryAt: number;
  /** True when apiFetch will re-send the request automatically. */
  willRetry: boolean;
}

export interface ApiFetchOptions {
  /**
   * Wait out a 429 and re-send automatically. `true` uses the defaults
   * (2 retries, waits of up to 60 s each). Rate-limited requests were not
   * processed by the server, so re-sending them is safe.
   */
  retryOnRateLimit?: boolean | { maxRetries?: number; maxWaitSeconds?: number };
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_WAIT_SECONDS = 60;

const quotas = new Map<string, RateLimitQuota>();
const quotaListeners = new Set<() => void>();

function emitQuotaChange(): void {
  quotaListeners.forEach((listener) => listener());
}

/** Subscribe to quota changes (for useSyncExternalStore). */
export function subscribeRateLimitQuota(listener: () => void): () => void {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
}

/** Latest known quota for a bucket. Stable reference until it changes. */
export function getRateLimitQuota(bucket: string): RateLimitQuota | undefined {
  return quotas.get(bucket);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

function pathnameOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0];
  }
}

/**
 * Booking endpoints → "book", chat endpoints → "chat", everything else
 * "other". Previously every non-booking 429 (e.g. /api/venues) counted as
 * "chat" and locked the chat input.
 */
export function classifyEndpoint(url: string): RateLimitEndpoint {
  const path = pathnameOf(url);
  // Path only: a query like ?next=/book must not change the bucket.
  if (path.includes("/book") || path.includes("/confirm") || path.includes("/reservations")) {
    return "book";
  }
  if (path === "/api/chat" || path.startsWith("/api/chat/")) return "chat";
  return "other";
}

function bucketFor(url: string): string {
  const endpoint = classifyEndpoint(url);
  return endpoint === "other" ? pathnameOf(url) : endpoint;
}

/**
 * Interpret a reset value that may be delta-seconds, epoch seconds or
 * epoch milliseconds. Returns an epoch-ms timestamp.
 */
function resetToEpochMs(value: number, now: number): number {
  if (value > 1e12) return value; // epoch ms
  if (value > 1e9) return value * 1000; // epoch seconds
  return now + value * 1000; // delta seconds
}

function headerNumber(headers: Headers, ...names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Seconds to wait before retrying a 429, from headers or JSON body. */
export async function retryAfterSeconds(response: Response): Promise<number> {
  const now = Date.now();
  const retryAfterHeader = response.headers.get("Retry-After");
  if (retryAfterHeader) {
    const parsedInt = parseInt(retryAfterHeader, 10);
    if (!isNaN(parsedInt)) return Math.max(1, parsedInt);
    const dateMs = Date.parse(retryAfterHeader);
    if (!isNaN(dateMs)) return Math.max(1, Math.ceil((dateMs - now) / 1000));
    return 60;
  }

  const reset = headerNumber(response.headers, "X-RateLimit-Reset", "RateLimit-Reset");
  if (reset !== null && reset > 0) {
    return Math.max(1, Math.ceil((resetToEpochMs(reset, now) - now) / 1000));
  }

  try {
    const data = await response.clone().json();
    const val = data.retryAfter ?? data.retry_after ?? data.resetIn;
    if (typeof val === "number") return Math.max(1, Math.ceil(val));
    if (typeof val === "string") return Math.max(1, parseInt(val, 10) || 60);
  } catch {
    // not JSON
  }
  return 60;
}

/** Record quota headers (any status) so useRateLimit can show usage. */
function recordQuota(bucket: string, response: Response, retryAt: number | null): void {
  const now = Date.now();
  const limit = headerNumber(response.headers, "X-RateLimit-Limit", "RateLimit-Limit");
  const remaining = headerNumber(response.headers, "X-RateLimit-Remaining", "RateLimit-Remaining");
  const reset = headerNumber(response.headers, "X-RateLimit-Reset", "RateLimit-Reset");
  const prev = quotas.get(bucket);
  if (limit === null && remaining === null && reset === null && retryAt === null) {
    // A non-429 proves the bucket accepts requests again: drop a stale block.
    if (prev?.retryAt) {
      quotas.set(bucket, { ...prev, retryAt: null });
      emitQuotaChange();
    }
    return;
  }

  quotas.set(bucket, {
    bucket,
    limit: limit ?? prev?.limit ?? null,
    remaining: retryAt !== null ? 0 : (remaining ?? prev?.remaining ?? null),
    resetAt: reset !== null && reset > 0 ? resetToEpochMs(reset, now) : (prev?.resetAt ?? null),
    retryAt: retryAt ?? (prev?.retryAt && prev.retryAt > now ? prev.retryAt : null),
  });
  emitQuotaChange();
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * fetch() wrapper: CSRF handling, rate-limit quota tracking, a countdown
 * toast on HTTP 429 (via the "rate-limit-triggered" event) and optional
 * automatic retry once the quota resets.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const url = requestUrl(input);
  const endpoint = classifyEndpoint(url);
  const bucket = bucketFor(url);

  const retry = options.retryOnRateLimit;
  const maxRetries = !retry ? 0 : retry === true ? DEFAULT_MAX_RETRIES : (retry.maxRetries ?? DEFAULT_MAX_RETRIES);
  const maxWaitSeconds =
    retry && retry !== true ? (retry.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS) : DEFAULT_MAX_WAIT_SECONDS;
  const signal =
    init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);

  for (let attempt = 0; ; attempt++) {
    // When retrying, don't hit the server again before its quota resets.
    const pendingRetryAt = maxRetries > 0 ? quotas.get(bucket)?.retryAt : null;
    if (pendingRetryAt && pendingRetryAt > Date.now()) {
      const waitMs = pendingRetryAt - Date.now();
      if (waitMs <= maxWaitSeconds * 1000) await sleep(waitMs, signal);
    }

    // A Request body can only be read once; send a fresh clone per attempt.
    const attemptInput =
      typeof Request !== "undefined" && input instanceof Request && maxRetries > 0
        ? input.clone()
        : input;
    const response = await sendWithCsrf(attemptInput, init);

    if (response.status !== 429) {
      recordQuota(bucket, response, null);
      return response;
    }

    const seconds = await retryAfterSeconds(response);
    const retryAt = Date.now() + seconds * 1000;
    recordQuota(bucket, response, retryAt);

    const willRetry = attempt < maxRetries && seconds <= maxWaitSeconds;

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<RateLimitEventDetail>("rate-limit-triggered", {
          detail: { retryAfter: seconds, endpoint, bucket, retryAt, willRetry },
        }),
      );
    }

    if (!willRetry) return response;
    await sleep(seconds * 1000, signal);
  }
}

/** Clear tracked quotas. Exported for tests only. @internal */
export function _resetRateLimitQuotasForTesting(): void {
  quotas.clear();
  emitQuotaChange();
}

/**
 * Reset internal CSRF state. Exported for use in tests only — allows each test
 * case to start with a clean slate without leaking state between cases.
 * @internal
 */
export function _resetCsrfStateForTesting(): void {
  _csrfToken = null;
  _csrfFetchedAt = 0;
  _csrfRefreshPromise = null;
}

/**
 * Set internal CSRF state directly. Exported for use in tests only.
 * @internal
 */
export function _setCsrfTokenForTesting(
  token: string | null,
  fetchedAt: number = Date.now(),
): void {
  _csrfToken = token;
  _csrfFetchedAt = fetchedAt;
  _csrfRefreshPromise = null;
}
