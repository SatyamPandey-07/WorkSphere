"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SearchableVenue,
  SearchResult,
  SearchWorkerRequest,
  SearchWorkerResponse,
  searchVenues,
} from "@/workers/searchWorker";

export interface UseSearchWorkerOptions {
  venues?: SearchableVenue[];
  debounceMs?: number;
  limit?: number;
  threshold?: number;
  initialQuery?: string;
}

export interface UseSearchWorkerReturn {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  isLoading: boolean;
  searchDurationMs: number;
  indexVenues: (venues: SearchableVenue[]) => void;
  searchNow: (q?: string) => void;
  terminate: () => void;
}

export function useSearchWorker(
  options: UseSearchWorkerOptions = {}
): UseSearchWorkerReturn {
  const {
    venues,
    debounceMs = 150,
    limit = 20,
    threshold = 0.25,
    initialQuery = "",
  } = options;

  const [query, setQuery] = useState<string>(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchDurationMs, setSearchDurationMs] = useState<number>(0);

  const workerRef = useRef<Worker | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRequestIdRef = useRef<number>(0);
  const cachedVenuesRef = useRef<SearchableVenue[]>(venues || []);

  useEffect(() => {
    if (venues) {
      cachedVenuesRef.current = venues;
    }
  }, [venues]);

  // Initialize Worker
  useEffect(() => {
    if (typeof window === "undefined") return;

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL("@/workers/searchWorker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === "RESULTS") {
          setResults(msg.results);
          setSearchDurationMs(msg.durationMs);
          setIsLoading(false);
        } else if (msg.type === "INDEXED") {
          setIsLoading(false);
        } else if (msg.type === "ERROR") {
          console.error("[useSearchWorker] Worker error:", msg.error);
          setIsLoading(false);
        }
      };

      workerRef.current = worker;

      // Index initial venues if provided
      if (cachedVenuesRef.current.length > 0) {
        worker.postMessage({
          type: "INDEX",
          venues: cachedVenuesRef.current,
        } as SearchWorkerRequest);
      }
    } catch {
      // Fallback for environments where Web Worker constructor fails (e.g. test environments)
      workerRef.current = null;
    }

    return () => {
      if (worker) {
        worker.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Index venues in worker
  const indexVenues = useCallback((newVenues: SearchableVenue[]) => {
    cachedVenuesRef.current = newVenues;
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: "INDEX",
        venues: newVenues,
      } as SearchWorkerRequest);
    }
  }, []);

  // Immediate or debounced search execution
  const executeSearch = useCallback(
    (searchQuery: string) => {
      const requestId = `req_${++currentRequestIdRef.current}`;
      setIsLoading(true);

      if (workerRef.current) {
        workerRef.current.postMessage({
          type: "SEARCH",
          query: searchQuery,
          limit,
          threshold,
          requestId,
        } as SearchWorkerRequest);
      } else {
        // Main-thread fallback
        const start = performance.now();
        const fallbackResults = searchVenues(
          cachedVenuesRef.current,
          searchQuery,
          threshold,
          limit
        );
        setResults(fallbackResults);
        setSearchDurationMs(Number((performance.now() - start).toFixed(2)));
        setIsLoading(false);
      }
    },
    [limit, threshold]
  );

  // Debounced search on query change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(query);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, debounceMs, executeSearch]);

  const searchNow = useCallback(
    (customQuery?: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      executeSearch(customQuery !== undefined ? customQuery : query);
    },
    [executeSearch, query]
  );

  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  return {
    query,
    setQuery,
    results,
    isLoading,
    searchDurationMs,
    indexVenues,
    searchNow,
    terminate,
  };
}

export default useSearchWorker;
