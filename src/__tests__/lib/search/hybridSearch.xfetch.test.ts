import {
    XFetchVectorCache,
    shouldTriggerXFetchEarlyRefresh,
    DEFAULT_BASELINE_DELTA_MS,
} from '@/lib/search/hybridSearch';

describe('XFetchVectorCache (Stampede Prevention & Cold Delta Seeding)', () => {
    test('seeds cold entries initialized with deltaMs=0 using baselineDeltaMs so early refresh triggers before expiry', () => {
        const nowMs = 1_000_000;
        const expiryMs = nowMs + 100; // 100ms remaining before hard expiry

        // Cold entry where deltaMs was uninitialized (0)
        const coldEntry = {
            deltaMs: 0,
            expiryMs,
        };

        // With baselineDeltaMs = 250ms and randomFn = 0.1 (-ln(0.1) ≈ 2.302),
        // earlyWindow = 250 * 1.0 * 2.302 ≈ 575ms >= 100ms remaining => triggers early refresh!
        const shouldRefresh = shouldTriggerXFetchEarlyRefresh(coldEntry, {
            nowMs,
            beta: 1.0,
            baselineDeltaMs: DEFAULT_BASELINE_DELTA_MS,
            randomFn: () => 0.1,
        });

        expect(shouldRefresh).toBe(true);
    });

    test('setEntry enforces baselineDeltaMs floor when deltaMs is 0 or omitted', () => {
        const cache = new XFetchVectorCache<number[]>({
            baselineDeltaMs: 250,
        });

        const entry = cache.setEntry('quiet cafe near me', [0.12, 0.84], {
            deltaMs: 0,
        });

        expect(entry.deltaMs).toBe(250);
    });

    test('coalesces 25 simultaneous cold-cache requests for "quiet cafe near me" into a single embedding API call', async () => {
        let clockMs = 10_000;
        const cache = new XFetchVectorCache<number[]>({
            ttlMs: 60_000,
            baselineDeltaMs: 250,
            nowFn: () => clockMs,
        });

        let resolveUpstream!: (vec: number[]) => void;
        const computeSpy = jest.fn(
            () =>
                new Promise<number[]>((resolve) => {
                    resolveUpstream = resolve;
                })
        );

        // Fire 25 concurrent requests for the same popular query
        const pendingRequests = Array.from({ length: 25 }, (_, idx) =>
            cache.getOrCompute(
                idx % 2 === 0 ? 'quiet cafe near me' : '  Quiet Cafe   Near Me ',
                computeSpy
            )
        );

        expect(computeSpy).toHaveBeenCalledTimes(1);

        clockMs += 180; // Upstream embedding call took 180ms (< 250ms baseline -> seeded to 250ms)
        resolveUpstream([0.11, 0.22, 0.33]);

        const results = await Promise.all(pendingRequests);
        expect(results).toHaveLength(25);
        for (const res of results) {
            expect(res.value).toEqual([0.11, 0.22, 0.33]);
            expect(res.cacheStatus).toBe('MISS');
        }

        const stored = cache.getEntry('quiet cafe near me')!;
        expect(stored.deltaMs).toBe(250);
    });

    test('triggers non-blocking single-flight early background refresh near expiry without stampeding', async () => {
        let clockMs = 50_000;
        const cache = new XFetchVectorCache<number[]>({
            ttlMs: 10_000, // Expires at 60,000ms
            baselineDeltaMs: 300,
            nowFn: () => clockMs,
            randomFn: () => 0.05, // -ln(0.05) ≈ 2.995 => earlyWindow ≈ 898ms
        });

        cache.setEntry('quiet cafe near me', [1, 2, 3], {
            ttlMs: 10_000,
            deltaMs: 0, // Cold uninitialized delta
        });

        // Advance clock to 59,400ms (600ms left < 898ms XFetch early window)
        clockMs = 59_400;

        let resolveRefresh!: (vec: number[]) => void;
        const refreshSpy = jest.fn(
            () =>
                new Promise<number[]>((resolve) => {
                    resolveRefresh = resolve;
                })
        );

        // 10 concurrent requests arrive during the early-refresh window
        const concurrentHits = await Promise.all(
            Array.from({ length: 10 }, () =>
                cache.getOrCompute('quiet cafe near me', refreshSpy)
            )
        );

        // Only ONE background refresh is spawned while all 10 callers get immediate cached values
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(concurrentHits[0].cacheStatus).toBe('EARLY_REFRESH');
        expect(concurrentHits[0].value).toEqual([1, 2, 3]);
        expect(concurrentHits[1].cacheStatus).toBe('HIT');

        // Complete background refresh -> new embedding vector is now live before hard expiry
        clockMs = 59_650;
        resolveRefresh([4, 5, 6]);
        await Promise.resolve();
        await Promise.resolve();

        const updated = await cache.getOrCompute('quiet cafe near me', refreshSpy, {
            randomFn: () => 0.99,
        });
        expect(updated.value).toEqual([4, 5, 6]);
        expect(updated.cacheStatus).toBe('HIT');
    });
});