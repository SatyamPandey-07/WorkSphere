import { CSRF_HEADER_NAME, CSRF_PROTECTED_METHODS } from "./csrf";

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

export async function apiFetch(
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
        data?.error?.toLowerCase().includes("csrf")
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

  if (response.status === 429) {
    const urlString =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url || "";

    let endpoint = "chat";
    if (
      urlString.includes("/book") ||
      urlString.includes("/confirm") ||
      urlString.includes("/reservations")
    ) {
      endpoint = "book";
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    const resetHeader = response.headers.get("X-RateLimit-Reset");
    let seconds = 60;

    if (retryAfterHeader) {
      const parsedInt = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedInt)) {
        seconds = Math.max(1, parsedInt);
      } else {
        const dateMs = Date.parse(retryAfterHeader);
        if (!isNaN(dateMs)) {
          seconds = Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
        } else {
          seconds = 60;
        }
      }
    } else if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10);
      if (!isNaN(resetTime) && resetTime > 0) {
        if (resetTime > 1e9) {
          seconds = Math.max(1, Math.ceil(resetTime - Date.now() / 1000));
        } else {
          seconds = Math.max(1, resetTime);
        }
      }
    } else {
      try {
        const clone = response.clone();
        const data = await clone.json();
        const val = data.retryAfter ?? data.retry_after ?? data.resetIn;
        if (typeof val === "number") {
          seconds = Math.max(1, Math.ceil(val));
        } else if (typeof val === "string") {
          seconds = Math.max(1, parseInt(val, 10) || 60);
        }
      } catch {
        // ignore
      }
    }

    if (typeof window !== "undefined") {
      const event = new CustomEvent("rate-limit-triggered", {
        detail: { retryAfter: seconds, endpoint },
      });
      window.dispatchEvent(event);
    }
  }

  return response;
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
