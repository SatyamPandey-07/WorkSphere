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

/** Cached CSRF token; refreshed on 403 CSRF rejection. */
let _csrfToken: string | null = null;

/**
 * Fetch (or return cached) CSRF token from /api/auth/csrf-token.
 * Used to auto-refresh the token when a session stays open >24 h.
 */
async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    _csrfToken = data.csrfToken ?? null;
    return _csrfToken;
  } catch {
    return null;
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  // Auto-refresh CSRF token and retry once on 403 with CSRF rejection code.
  // This handles sessions left open >24 hours where the cookie expired.
  if (response.status === 403) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data?.code === "CSRF_INVALID" || data?.error?.toLowerCase().includes("csrf")) {
        const freshToken = await fetchCsrfToken();
        if (freshToken) {
          const retryHeaders = new Headers(
            init?.headers instanceof Headers
              ? init.headers
              : new Headers(init?.headers ?? {}),
          );
          retryHeaders.set("x-csrf-token", freshToken);
          return fetch(input, { ...init, headers: retryHeaders });
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
