"use client";

import { useCallback, useEffect, useRef } from "react";
import i18n from "i18next";
import { CSRF_HEADER_NAME } from "@/lib/csrf";

// Module-level cache so any component/fetch helper can read the latest token
// without prop-drilling, while still being refreshed reactively by the hook.
let currentCsrfToken: string | null = null;

export function getCurrentCsrfToken(): string | null {
  return currentCsrfToken;
}

/** Attach the current CSRF token to a fetch init's headers for a mutating request. */
export function withCsrfHeader(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (currentCsrfToken) {
    headers.set(CSRF_HEADER_NAME, currentCsrfToken);
  }
  return { ...init, headers };
}

let interceptorInstalled = false;

/**
 * Monkey-patches window.fetch (once) so every same-origin mutating request to
 * our own /api routes automatically carries the current CSRF header. This
 * avoids having to hand-edit every existing (and future) form/fetch call site
 * across the app — the token lifecycle and its application to requests both
 * live in one place.
 */
function installCsrfFetchInterceptor() {
  if (interceptorInstalled || typeof window === "undefined") return;
  interceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    const isInputRequest = typeof Request !== "undefined" && input instanceof Request;
    const method = (init?.method || (isInputRequest ? input.method : "GET")).toUpperCase();
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const isSameOriginApi = url.startsWith("/api") || url.startsWith(`${window.location.origin}/api`);

    if (isMutating && isSameOriginApi) {
      const headers = new Headers(init?.headers ?? (isInputRequest ? input.headers : undefined));
      if (currentCsrfToken) {
        headers.set(CSRF_HEADER_NAME, currentCsrfToken);
      }
      const response = await originalFetch(input, { ...init, headers });
      if (response.status === 403) {
        const clone = response.clone();
        try {
          const body = await clone.json();
          if (body && body.error && body.error.toLowerCase().includes("csrf")) {
            const freshToken = await fetchFreshToken();
            if (freshToken) {
              const retryHeaders = new Headers(init?.headers ?? (isInputRequest ? input.headers : undefined));
              retryHeaders.set(CSRF_HEADER_NAME, freshToken);
              return originalFetch(input, { ...init, headers: retryHeaders });
            }
          }
        } catch {
          // Response was not JSON or did not have CSRF error
        }
      }
      return response;
    }

    return originalFetch(input, init);
  };
}

async function fetchFreshToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/csrf-token", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    currentCsrfToken = data.csrfToken ?? null;
    return currentCsrfToken;
  } catch {
    // Network hiccup — leave the previous token in place; the next mutating
    // request will surface a 403 if it's genuinely stale, which triggers a retry.
    return currentCsrfToken;
  }
}

/**
 * Fetches a CSRF token on mount and automatically re-requests a fresh one
 * whenever the app's locale changes. This directly closes the gap described
 * in issue #201: previously nothing re-bound the token after a locale switch,
 * so this hook (wired in from I18nProvider) guarantees a valid token is always
 * in hand before the next form submission.
 */
export function useCsrfToken() {
  const initialized = useRef(false);

  const refresh = useCallback(() => fetchFreshToken(), []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    installCsrfFetchInterceptor();
    void fetchFreshToken();

    const handleLanguageChanged = () => {
      void fetchFreshToken();
    };

    i18n.on("languageChanged", handleLanguageChanged);
    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, []);

  return { refresh };
}
