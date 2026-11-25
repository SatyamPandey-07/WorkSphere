import {
    searchVenuesSemantic,
    SemanticSearchRequestManager,
    isAbortError,
} from '@/lib/search/semanticSearchClient';

describe('semanticSearchClient', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('detects DOMException and Error AbortError instances', () => {
        expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        expect(isAbortError(err)).toBe(true);
        expect(isAbortError(new Error('Network failure'))).toBe(false);
    });

    test('returns early with aborted: true when passed an already-aborted signal', async () => {
        const fetchSpy = jest.fn();
        global.fetch = fetchSpy;

        const controller = new AbortController();
        controller.abort();

        const result = await searchVenuesSemantic(
            { query: 'quiet cafe with outlets' },
            { signal: controller.signal }
        );

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result).toEqual({
            results: [],
            aborted: true,
            query: 'quiet cafe with outlets',
        });
    });

    test('aborts prior in-flight request when a newer search is submitted', async () => {
        const signals: AbortSignal[] = [];

        global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
            const signal = init?.signal as AbortSignal;
            signals.push(signal);

            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });

                // Resolve only the second (latest) request
                if (signals.length === 2) {
                    setTimeout(() => {
                        resolve(
                            new Response(
                                JSON.stringify({
                                    results: [
                                        {
                                            id: 'venue-2',
                                            name: 'Verge Coworking',
                                            latitude: 18.5204,
                                            longitude: 73.8567,
                                            score: 0.94,
                                        },
                                    ],
                                }),
                                { status: 200, headers: { 'Content-Type': 'application/json' } }
                            )
                        );
                    }, 10);
                }
            });
        }) as jest.Mock;

        const manager = new SemanticSearchRequestManager();

        const firstSearch = manager.search({ query: 'qui' });
        const secondSearch = manager.search({ query: 'quiet library' });

        const [firstRes, secondRes] = await Promise.all([firstSearch, secondSearch]);

        expect(signals).toHaveLength(2);
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);

        expect(firstRes).toEqual({
            results: [],
            aborted: true,
            query: 'qui',
        });

        expect(secondRes.aborted).toBe(false);
        expect(secondRes.query).toBe('quiet library');
        expect(secondRes.results).toHaveLength(1);
        expect(secondRes.results[0].name).toBe('Verge Coworking');
    });
});