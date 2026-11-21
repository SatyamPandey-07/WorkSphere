export interface SemanticVenueSearchParams {
    query: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    maxNoiseDb?: number;
    amenities?: string[];
    limit?: number;
}

export interface SemanticVenueResult {
    id: string;
    name: string;
    address?: string | null;
    latitude: number;
    longitude: number;
    score: number;
    similarity?: number;
    noiseDb?: number | null;
    wifiSpeedMbps?: number | null;
    outletDensity?: number | null;
    amenities?: string[];
}

export interface SemanticSearchResponse {
    results: SemanticVenueResult[];
    aborted: boolean;
    query: string;
    latencyMs?: number;
}

export interface SemanticSearchOptions {
    signal?: AbortSignal;
    endpoint?: string;
}

/**
 * Type guard checking whether an unknown error originated from an AbortController cancellation.
 */
export function isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    if (error instanceof Error && error.name === 'AbortError') return true;
    if (
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: unknown }).name === 'AbortError'
    ) {
        return true;
    }
    return false;
}

/**
 * Combines an optional external AbortSignal with an internal AbortController
 * so callers can cancel via either mechanism without memory leaks.
 */
function linkAbortSignals(externalSignal?: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
} {
    const controller = new AbortController();

    if (!externalSignal) {
        return { controller, cleanup: () => { } };
    }

    if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
        return { controller, cleanup: () => { } };
    }

    const onExternalAbort = () => {
        controller.abort(externalSignal.reason);
    };

    externalSignal.addEventListener('abort', onExternalAbort, { once: true });

    return {
        controller,
        cleanup: () => {
            externalSignal.removeEventListener('abort', onExternalAbort);
        },
    };
}

/**
 * Executes a semantic venue search against the embedding/hybrid search endpoint.
 * Immediately returns `{ results: [], aborted: true }` when cancelled via `AbortSignal`
 * so stale responses never overwrite newer client state.
 */
export async function searchVenuesSemantic(
    params: SemanticVenueSearchParams,
    options: SemanticSearchOptions = {}
): Promise<SemanticSearchResponse> {
    const trimmedQuery = params.query.trim();
    const endpoint = options.endpoint ?? '/api/venues/search';

    if (!trimmedQuery) {
        return {
            results: [],
            aborted: Boolean(options.signal?.aborted),
            query: trimmedQuery,
        };
    }

    if (options.signal?.aborted) {
        return {
            results: [],
            aborted: true,
            query: trimmedQuery,
        };
    }

    const { controller, cleanup } = linkAbortSignals(options.signal);
    const startedAt = performance.now();

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...params,
                query: trimmedQuery,
            }),
            signal: controller.signal,
        });

        // Guard against cancellation occurring right as headers arrive
        if (controller.signal.aborted) {
            return {
                results: [],
                aborted: true,
                query: trimmedQuery,
            };
        }

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(
                `Semantic venue search failed (${response.status}): ${errorBody || response.statusText}`
            );
        }

        const data = (await response.json()) as {
            venues?: SemanticVenueResult[];
            results?: SemanticVenueResult[];
        };

        // Final check after body JSON parsing so an aborted stream never resolves stale data
        if (controller.signal.aborted) {
            return {
                results: [],
                aborted: true,
                query: trimmedQuery,
            };
        }

        const venues = Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.venues)
                ? data.venues
                : [];

        return {
            results: venues,
            aborted: false,
            query: trimmedQuery,
            latencyMs: Math.round(performance.now() - startedAt),
        };
    } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted) {
            return {
                results: [],
                aborted: true,
                query: trimmedQuery,
            };
        }
        throw error;
    } finally {
        cleanup();
    }
}

/**
 * Stateful request coordinator that automatically aborts any prior in-flight
 * embedding/search request whenever a new search is submitted on the same channel.
 */
export class SemanticSearchRequestManager {
    private activeControllers = new Map<string, AbortController>();
    private latestSequence = new Map<string, number>();

    /**
     * Cancels any currently pending request on `channelKey`.
     */
    public cancel(channelKey = 'default'): void {
        const existing = this.activeControllers.get(channelKey);
        if (existing && !existing.signal.aborted) {
            existing.abort(new DOMException('Superseded by newer search query', 'AbortError'));
        }
        this.activeControllers.delete(channelKey);
    }

    /**
     * Cancels all pending requests across every channel.
     */
    public cancelAll(): void {
        for (const [key, controller] of this.activeControllers.entries()) {
            if (!controller.signal.aborted) {
                controller.abort(new DOMException('All semantic searches cancelled', 'AbortError'));
            }
            this.activeControllers.delete(key);
        }
    }

    /**
     * Submits a new semantic search, cancelling any prior in-flight request first
     * and guarding against out-of-order resolution via monotonic sequence IDs.
     */
    public async search(
        params: SemanticVenueSearchParams,
        options: SemanticSearchOptions & { channelKey?: string } = {}
    ): Promise<SemanticSearchResponse> {
        const channelKey = options.channelKey ?? 'default';

        // Abort previous pending embedding request immediately
        this.cancel(channelKey);

        const nextSeq = (this.latestSequence.get(channelKey) ?? 0) + 1;
        this.latestSequence.set(channelKey, nextSeq);

        const { controller, cleanup } = linkAbortSignals(options.signal);
        this.activeControllers.set(channelKey, controller);

        try {
            const response = await searchVenuesSemantic(params, {
                ...options,
                signal: controller.signal,
            });

            // If a newer request started while this one was finishing, treat as aborted/stale
            if (
                controller.signal.aborted ||
                this.latestSequence.get(channelKey) !== nextSeq
            ) {
                return {
                    results: [],
                    aborted: true,
                    query: params.query.trim(),
                };
            }

            return response;
        } finally {
            cleanup();
            if (this.activeControllers.get(channelKey) === controller) {
                this.activeControllers.delete(channelKey);
            }
        }
    }
}

export const defaultSemanticSearchManager = new SemanticSearchRequestManager();