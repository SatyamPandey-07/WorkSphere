import { TimeSeriesStore } from '@/workers/forecasting/TimeSeriesStore';
import { PredictorEngine } from '@/workers/forecasting/PredictorEngine';

describe('TimeSeriesStore - Welford Rolling Variance & Numerical Stability (#5365)', () => {
    it('initializes with zero count, mean, and variance', () => {
        const store = new TimeSeriesStore(10);
        expect(store.getCount()).toBe(0);
        expect(store.getMean()).toBe(0);
        expect(store.getRollingMean()).toBe(0);
        expect(store.getVariance()).toBe(0);
        expect(store.getRollingVariance()).toBe(0);
        expect(store.getStandardDeviation()).toBe(0);
        expect(store.getRollingStandardDeviation()).toBe(0);
    });

    it('computes exact population and sample variance using Welford algorithm', () => {
        const store = new TimeSeriesStore(20);
        // Data: [2, 4, 4, 4, 5, 5, 7, 9], N = 8, mean = 5, sum of squared diffs = 32
        store.pushMultiple([2, 4, 4, 4, 5, 5, 7, 9]);

        expect(store.getCount()).toBe(8);
        expect(store.getMean()).toBe(5);
        // Population variance = 32 / 8 = 4
        expect(store.getVariance(false)).toBeCloseTo(4.0, 5);
        expect(store.getStandardDeviation(false)).toBeCloseTo(2.0, 5);

        // Sample variance = 32 / 7 = 4.57142857
        expect(store.getVariance(true)).toBeCloseTo(32 / 7, 5);
        expect(store.getStandardDeviation(true)).toBeCloseTo(Math.sqrt(32 / 7), 5);
    });

    it('prevents catastrophic cancellation on constant values with zero variance', () => {
        const store = new TimeSeriesStore(100);
        const constantValues = new Array(50).fill(75.5);
        store.pushMultiple(constantValues);

        expect(store.getMean()).toBeCloseTo(75.5, 4);
        expect(store.getVariance()).toBe(0);
        expect(store.getStandardDeviation()).toBe(0);
        expect(Number.isNaN(store.getVariance())).toBe(false);
        expect(Number.isNaN(store.getStandardDeviation())).toBe(false);
        expect(store.getVariance()).toBeGreaterThanOrEqual(0);
    });

    it('handles large numbers without negative variance or NaN standard deviations', () => {
        const store = new TimeSeriesStore(50);
        // Large identical numbers can cause naive sum-of-squares to compute negative variance
        const largeValues = [1000000, 1000000, 1000000, 1000000];
        store.pushMultiple(largeValues);

        const variance = store.getVariance();
        const stdDev = store.getStandardDeviation();

        expect(variance).toBe(0);
        expect(stdDev).toBe(0);
        expect(variance).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(variance)).toBe(false);
        expect(Number.isNaN(stdDev)).toBe(false);
    });

    it('maintains numerical stability and accurate statistics upon circular buffer eviction', () => {
        const capacity = 5;
        const store = new TimeSeriesStore(capacity);

        // Push initial values [10, 10, 10, 10, 10]
        store.pushMultiple([10, 10, 10, 10, 10]);
        expect(store.getCount()).toBe(5);
        expect(store.getMean()).toBe(10);
        expect(store.getVariance()).toBe(0);

        // Overwrite older entries with alternating values: [20, 40, 20, 40, 20]
        store.pushMultiple([20, 40, 20, 40, 20]);
        expect(store.getCount()).toBe(5);
        expect(store.getData()).toEqual([20, 40, 20, 40, 20]);

        // Mean of [20, 40, 20, 40, 20] = 28
        // Diffs: -8, 12, -8, 12, -8. Squares: 64 + 144 + 64 + 144 + 64 = 480
        // Population variance = 480 / 5 = 96
        expect(store.getMean()).toBeCloseTo(28, 4);
        expect(store.getVariance(false)).toBeCloseTo(96, 4);
        expect(store.getStandardDeviation(false)).toBeCloseTo(Math.sqrt(96), 4);
    });

    it('handles single-item edge cases safely', () => {
        const store = new TimeSeriesStore(10);
        store.push(50);

        expect(store.getCount()).toBe(1);
        expect(store.getMean()).toBe(50);
        expect(store.getVariance(false)).toBe(0);
        expect(store.getVariance(true)).toBe(0); // Sample variance with N=1 protected against div by zero
        expect(store.getStandardDeviation(false)).toBe(0);
        expect(store.getStandardDeviation(true)).toBe(0);
    });

    it('resets all statistics when cleared', () => {
        const store = new TimeSeriesStore(10);
        store.pushMultiple([10, 20, 30, 40]);
        expect(store.getCount()).toBe(4);

        store.clear();
        expect(store.getCount()).toBe(0);
        expect(store.getMean()).toBe(0);
        expect(store.getVariance()).toBe(0);
        expect(store.getStandardDeviation()).toBe(0);
        expect(store.getData()).toEqual([]);
    });
});

describe('PredictorEngine with Welford Rolling Variance (#5365)', () => {
    it('tracks rolling variance and standard deviation across ingested telemetry', () => {
        const engine = new PredictorEngine();
        const venueId = 'venue-test-1';

        engine.ingestBatchTelemetry(venueId, [50, 50, 50, 50, 50]);

        const variance = engine.getRollingVariance(venueId);
        const stdDev = engine.getRollingStandardDeviation(venueId);

        expect(variance).toBe(0);
        expect(stdDev).toBe(0);
        expect(Number.isNaN(variance)).toBe(false);
    });

    it('returns null for unknown venue rolling variance', () => {
        const engine = new PredictorEngine();
        expect(engine.getRollingVariance('non-existent')).toBeNull();
        expect(engine.getRollingStandardDeviation('non-existent')).toBeNull();
    });

    it('detects flatline zero-variance data and produces stable flat forecasts', () => {
        const engine = new PredictorEngine();
        const venueId = 'venue-flatline';

        // Ingest 48 hours of constant 40% occupancy (zero variance)
        const flatData = new Array(48).fill(40);
        engine.ingestBatchTelemetry(venueId, flatData);

        const forecast = engine.getImmediateForecast(venueId);
        expect(forecast).not.toBeNull();
        expect(forecast).toHaveLength(8);
        expect(forecast).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
    });

    it('forecasts seasonal data when variance is non-zero', () => {
        const engine = new PredictorEngine();
        const venueId = 'venue-seasonal';

        // 48 hours with 24-hour daily cycle
        const pattern = [
            10, 10, 10, 10, 10, 15, 25, 45, 60, 75, 80, 85,
            80, 75, 70, 65, 55, 40, 30, 20, 15, 10, 10, 10
        ];
        const twoDays = [...pattern, ...pattern];
        engine.ingestBatchTelemetry(venueId, twoDays);

        const variance = engine.getRollingVariance(venueId);
        expect(variance).toBeGreaterThan(0);

        const forecast = engine.getImmediateForecast(venueId);
        expect(forecast).not.toBeNull();
        expect(forecast).toHaveLength(8);
        forecast?.forEach((val) => {
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThanOrEqual(100);
            expect(Number.isFinite(val)).toBe(true);
        });
    });
});
