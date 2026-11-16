'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    SemanticSearchRequestManager,
    SemanticVenueResult,
    SemanticVenueSearchParams,
} from '@/lib/search/semanticSearchClient';

interface UseSemanticVenueSearchOptions {
    debounceMs?: number;
    channelKey?: string;
}

export function useSemanticVenueSearch(
    options: UseSemanticVenueSearchOptions = {}
) {
    const { debounceMs = 200, channelKey = 'venue-semantic-search' } = options;

    const [results, setResults] = useState<SemanticVenueResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const managerRef = useRef<SemanticSearchRequestManager | null>(null);
    if (!managerRef.current) {
        managerRef.current = new SemanticSearchRequestManager();
    }

    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeRequestIdRef = useRef(0);

    const cancelPending = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        managerRef.current?.cancel(channelKey);
    }, [channelKey]);

    const executeSearch = useCallback(
        async (params: SemanticVenueSearchParams) => {
            const requestId = ++activeRequestIdRef.current;

            if (!params.query.trim()) {
                cancelPending();
                setResults([]);
                setError(null);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const response = await managerRef.current!.search(params, {
                    channelKey,
                });

                // Early return if aborted or superseded by a newer keystroke
                if (response.aborted || activeRequestIdRef.current !== requestId) {
                    return;
                }

                setResults(response.results);
                setIsLoading(false);
            } catch (err: unknown) {
                if (activeRequestIdRef.current !== requestId) {
                    return;
                }
                setError(err instanceof Error ? err.message : 'Search failed');
                setIsLoading(false);
            }
        },
        [cancelPending, channelKey]
    );

    const searchDebounced = useCallback(
        (params: SemanticVenueSearchParams) => {
            // Cancel any currently in-flight embedding request as soon as user types again
            cancelPending();

            if (!params.query.trim()) {
                activeRequestIdRef.current += 1;
                setResults([]);
                setError(null);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            debounceTimerRef.current = setTimeout(() => {
                void executeSearch(params);
            }, debounceMs);
        },
        [cancelPending, debounceMs, executeSearch]
    );

    useEffect(() => {
        return () => {
            cancelPending();
        };
    }, [cancelPending]);

    return {
        results,
        isLoading,
        error,
        searchDebounced,
        executeSearch,
        cancelPending,
    };
}