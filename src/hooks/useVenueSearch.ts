"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface VenueSearchResult {
  id: string;
  name: string;
  description?: string | null;
  address?: string | null;
  latitude?: number;
  longitude?: number;
  category?: string;
  rating?: number | null;
  wifiQuality?: number | null;
  hasOutlets?: boolean;
  noiseLevel?: string | null;
  imageUrl?: string | null;
  [key: string]: unknown;
}

export interface UseVenueSearchOptions {
  /** Search query string when used in controlled mode */
  query?: string;
  /** Initial query string for uncontrolled mode */
  initialQuery?: string;
  /** Debounce delay in milliseconds before dispatching fetch (default: 250ms) */
  debounceMs?: number;
  /** Minimum query length required to trigger search (default: 1) */
  minQueryLength?: number;
  /** Optional custom base API path (default: "/api/venues") */
  apiEndpoint?: string;
  /** Configurable semantic vector scoring weight (0.0 - 1.0 or 0 - 100) */
  semanticWeight?: number;
  /** Configurable full-text keyword scoring weight (0.0 - 1.0 or 0 - 100) */
  fullTextWeight?: number;
}

export interface UseVenueSearchReturn<T = VenueSearchResult> {
  query: string;
  setQuery: (query: string) => void;
  venues: T[];
  results: T[];
  suggestedQuery: string | null;
  isLoading: boolean;
  loading: boolean;
  /** True while a debounced search is waiting to fire (the user is still typing). */
  isDebouncing: boolean;
  error: string | null;
  clear: () => void;
  abort: () => void;
  search: (queryOverride?: string) => Promise<void>;
}

/**
 * Custom hook for debounced, cancelable venue search combining a monotonic
 * request generation counter (`requestIdRef`) with `AbortController` cleanup:
 * - Every query change invalidates earlier request IDs and aborts in-flight sockets.
 * - Out-of-order responses from slower earlier requests are discarded deterministically.
 */
export function useVenueSearch<T = VenueSearchResult>(
  queryOrOptions?: string | UseVenueSearchOptions,
  explicitOptions?: UseVenueSearchOptions,
): UseVenueSearchReturn<T> {
  const options: UseVenueSearchOptions =
    typeof queryOrOptions === "string"
      ? { query: queryOrOptions, ...explicitOptions }
      : (queryOrOptions ?? {});

  const {
    query: controlledQuery,
    initialQuery = "",
    debounceMs = 250,
    minQueryLength = 1,
    apiEndpoint = "/api/venues",
    semanticWeight,
    fullTextWeight,
  } = options;

  const isControlled = controlledQuery !== undefined;
  const [internalQuery, setInternalQuery] = useState(initialQuery);
  const activeQuery = isControlled ? controlledQuery : internalQuery;

  const [venues, setVenues] = useState<T[]>([]);
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);
  const lastRequestedQueryRef = useRef<string | null>(null);

  const abort = useCallback(() => {
    requestIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    lastRequestedQueryRef.current = null;
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setIsDebouncing(false);
    abort();
    setVenues([]);
    setSuggestedQuery(null);
    setIsLoading(false);
    setError(null);
    if (!isControlled) {
      setInternalQuery("");
    }
  }, [abort, isControlled]);

  const performSearch = useCallback(
    async (
      searchQuery?: string,
      externalController?: AbortController,
    ): Promise<void> => {
      const targetQuery =
        typeof searchQuery === "string" ? searchQuery : activeQuery;
      const trimmedQuery = targetQuery.trim();

      if (!trimmedQuery || trimmedQuery.length < minQueryLength) {
        abort();
        setVenues([]);
        setSuggestedQuery(null);
        setIsLoading(false);
        setError(null);
        return;
      }

      if (
        abortControllerRef.current &&
        abortControllerRef.current !== externalController
      ) {
        abortControllerRef.current.abort();
      }

      const controller = externalController ?? new AbortController();
      abortControllerRef.current = controller;
      const requestId = ++requestIdRef.current;
      lastRequestedQueryRef.current = trimmedQuery;

      setIsLoading(true);
      setError(null);
      setSuggestedQuery(null);

      try {
        const delimiter = apiEndpoint.includes("?") ? "&" : "?";
        let url = `${apiEndpoint}${delimiter}query=${encodeURIComponent(trimmedQuery)}`;
        if (semanticWeight !== undefined) {
          url += `&semanticWeight=${encodeURIComponent(String(semanticWeight))}`;
        }
        if (fullTextWeight !== undefined) {
          url += `&fullTextWeight=${encodeURIComponent(String(fullTextWeight))}`;
        }

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Search request failed with status ${response.status}`,
          );
        }

        const data = await response.json();

        // Discard stale or aborted responses
        if (
          requestId !== requestIdRef.current ||
          controller.signal.aborted ||
          abortControllerRef.current !== controller
        ) {
          return;
        }

        const items: T[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.venues)
            ? data.venues
            : [];

        setVenues(items);
        setSuggestedQuery(
          typeof data?.suggestedQuery === "string" ? data.suggestedQuery : null,
        );
        setIsLoading(false);
      } catch (err: unknown) {
        const isAbort =
          controller.signal.aborted ||
          (err instanceof DOMException &&
            (err.name === "AbortError" || err.code === 20)) ||
          (err instanceof Error && err.name === "AbortError") ||
          (typeof err === "object" &&
            err !== null &&
            "name" in err &&
            (err as { name: string }).name === "AbortError");

        if (isAbort) {
          if (requestId === requestIdRef.current) {
            abortControllerRef.current = null;
            lastRequestedQueryRef.current = null;
            setIsLoading(false);
          }
          return;
        }

        if (
          requestId === requestIdRef.current &&
          abortControllerRef.current === controller
        ) {
          lastRequestedQueryRef.current = null;
          setError(
            err instanceof Error
              ? err.message
              : "Failed to fetch venue search results",
          );
          setIsLoading(false);
        }
      }
    },
    [
      abort,
      activeQuery,
      apiEndpoint,
      fullTextWeight,
      minQueryLength,
      semanticWeight,
    ],
  );

  // Declarative effect: cleanup aborts any in-flight request immediately when activeQuery changes
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const trimmed = activeQuery.trim();
    if (!trimmed || trimmed.length < minQueryLength) {
      setIsDebouncing(false);
      abort();
      setVenues([]);
      setSuggestedQuery(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (debounceMs <= 0) {
      setIsDebouncing(false);
      void performSearch(trimmed, controller);
      return () => {
        requestIdRef.current += 1;
        controller.abort();
      };
    }

    setIsDebouncing(true);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setIsDebouncing(false);
      void performSearch(trimmed, controller);
    }, debounceMs);

    return () => {
      requestIdRef.current += 1;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      controller.abort();
    };
  }, [activeQuery, debounceMs, minQueryLength, performSearch, abort]);

  const handleSetQuery = useCallback(
    (newQuery: string) => {
      const trimmed = newQuery.trim();
      if (!trimmed || trimmed.length < minQueryLength) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        setIsDebouncing(false);
        abort();
        setVenues([]);
        setIsLoading(false);
        setError(null);
      }
      if (!isControlled) {
        setInternalQuery(newQuery);
      }
      setSuggestedQuery(null);
    },
    [abort, isControlled, minQueryLength],
  );

  const search = useCallback(
    async (queryOverride?: string): Promise<void> => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // An explicit search (Enter) bypasses the debounce, so nothing is pending any more.
      setIsDebouncing(false);

      const target =
        typeof queryOverride === "string" ? queryOverride : activeQuery;
      const trimmed = target.trim();
      if (trimmed !== "" && trimmed === lastRequestedQueryRef.current) {
        return;
      }

      await performSearch(target);
    },
    [activeQuery, performSearch],
  );

  return {
    query: activeQuery,
    setQuery: handleSetQuery,
    venues,
    results: venues,
    suggestedQuery,
    isLoading,
    loading: isLoading,
    isDebouncing,
    error,
    clear,
    abort,
    search,
  };
}

export const useDebouncedSearch = useVenueSearch;
