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
}

export interface UseVenueSearchReturn<T = VenueSearchResult> {
  query: string;
  setQuery: (query: string) => void;
  venues: T[];
  results: T[];
  isLoading: boolean;
  loading: boolean;
  error: string | null;
  suggestedQuery: string | null;
  notice: string | null;
  clear: () => void;
  abort: () => void;
  search: (queryOverride?: string) => Promise<void>;
}

/**
 * Custom hook for debounced, cancelable venue search with AbortController (#3513, #3773):
 * - 250ms debounce before dispatching network requests to avoid rapid request flooding.
 * - AbortController stored in a useRef to cancel any in-flight HTTP request prior to dispatching new queries.
 * - Silent handling of AbortError so canceled requests never overwrite newer responses.
 * - Prevents out-of-order race conditions when fast typing occurs.
 */
export function useVenueSearch<T = VenueSearchResult>(
  queryOrOptions?: string | UseVenueSearchOptions,
  explicitOptions?: UseVenueSearchOptions,
): UseVenueSearchReturn<T> {
  const options: UseVenueSearchOptions =
    typeof queryOrOptions === "string"
      ? { query: queryOrOptions, ...explicitOptions }
      : queryOrOptions ?? {};

  const {
    query: controlledQuery,
    initialQuery = "",
    debounceMs = 250,
    minQueryLength = 1,
    apiEndpoint = "/api/venues",
  } = options;

  const isControlled = controlledQuery !== undefined;
  const [internalQuery, setInternalQuery] = useState(initialQuery);
  const activeQuery = isControlled ? controlledQuery : internalQuery;

  const [venues, setVenues] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Active AbortController reference stored in a useRef to cancel in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Timer reference for debounce delay
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abort();
    setVenues([]);
    setIsLoading(false);
    setError(null);
    setSuggestedQuery(null);
    setNotice(null);
    if (!isControlled) {
      setInternalQuery("");
    }
  }, [abort, isControlled]);

  const performSearch = useCallback(
    async (searchQuery?: string): Promise<void> => {
      const targetQuery = typeof searchQuery === "string" ? searchQuery : activeQuery;
      const trimmedQuery = targetQuery.trim();

      if (!trimmedQuery || trimmedQuery.length < minQueryLength) {
        abort();
        setVenues([]);
        setIsLoading(false);
        setError(null);
        setSuggestedQuery(null);
        setNotice(null);
        return;
      }

      // Prior to dispatching a new search request, invoke abortControllerRef.current.abort()
      // to cancel any in-flight HTTP request.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      setSuggestedQuery(null);
      setNotice(null);

      try {
        const delimiter = apiEndpoint.includes("?") ? "&" : "?";
        const url = `${apiEndpoint}${delimiter}query=${encodeURIComponent(trimmedQuery)}`;

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Search request failed with status ${response.status}`);
        }

        const data: unknown = await response.json();

        // Guard against race conditions if controller was aborted or superseded
        if (controller.signal.aborted || abortControllerRef.current !== controller) {
          return;
        }

        const responseData =
          typeof data === "object" && data !== null
            ? (data as {
                venues?: unknown;
                suggestedQuery?: unknown;
                notice?: unknown;
              })
            : null;
        const items: T[] = Array.isArray(data)
          ? (data as T[])
          : Array.isArray(responseData?.venues)
            ? (responseData.venues as T[])
            : [];

        setVenues(items);
        setSuggestedQuery(
          typeof responseData?.suggestedQuery === "string"
            ? responseData.suggestedQuery
            : null,
        );
        setNotice(
          typeof responseData?.notice === "string" ? responseData.notice : null,
        );
        setIsLoading(false);
      } catch (err: unknown) {
        // Catch AbortError (or DOMException.ABORT_ERR) and ignore it silently
        // without setting an error banner or resetting results.
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
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
            setIsLoading(false);
          }
          return;
        }

        // Only set error if this is still the active request
        if (abortControllerRef.current === controller) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch venue search results",
          );
          setIsLoading(false);
        }
      }
    },
    [abort, activeQuery, apiEndpoint, minQueryLength],
  );

  // Debounced search trigger on activeQuery change (300ms default)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const trimmed = activeQuery.trim();
    if (!trimmed || trimmed.length < minQueryLength) {
      abort();
      setVenues([]);
      setIsLoading(false);
      setError(null);
      setSuggestedQuery(null);
      setNotice(null);
      return;
    }

    if (debounceMs <= 0) {
      void performSearch(trimmed);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      void performSearch(trimmed);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [activeQuery, debounceMs, minQueryLength, performSearch, abort]);

  // Clean up in-flight requests and timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handleSetQuery = useCallback(
    (newQuery: string) => {
      if (!isControlled) {
        setInternalQuery(newQuery);
        setSuggestedQuery(null);
        setNotice(null);
      }
    },
    [isControlled],
  );

  return {
    query: activeQuery,
    setQuery: handleSetQuery,
    venues,
    results: venues,
    isLoading,
    loading: isLoading,
    error,
    suggestedQuery,
    notice,
    clear,
    abort,
    search: performSearch,
  };
}

export const useDebouncedSearch = useVenueSearch;