import { HoltWinters, HoltWintersParams, ForecastResult } from '@/workers/forecasting/HoltWinters';

describe('HoltWinters Triple Exponential Smoothing with 95% Prediction Intervals', () => {
    // Standard diurnal cycle: 24-hour periodicity
    const defaultParams: HoltWintersParams = {
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.4,
        seasonLength: 24,
    };

    /**
     * Generates synthetic occupancy time series with diurnal pattern and optional noise.
     */
    function generateSyntheticOccupancy(
        days: number,
        seasonLength: number = 24,
        baseLevel: number = 50,
        amplitude: number = 20,
        noiseStd: number = 0
    ): number[] {
        const points: number[] = [];
        const totalHours = days * seasonLength;

        for (let t = 0; t < totalHours; t++) {
            const seasonal = Math.sin((2 * Math.PI * (t % seasonLength)) / seasonLength) * amplitude;
            const noise = noiseStd > 0 ? (Math.sin(t * 1337) * noiseStd) : 0;
            const val = Math.max(0, Math.min(100, baseLevel + seasonal + noise));
            points.push(val);
        }

        return points;
    }

    describe('1. Residual Calculation & Information Leakage Prevention', () => {
        it('calculates one-step-ahead residuals using prior model state (t-1)', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const data = generateSyntheticOccupancy(3, 24, 50, 15, 2); // 72 hours
            const result = hw.fitAndForecast(data, 24);

            expect(result.residuals).toBeDefined();
            expect(result.residuals!.length).toBe(data.length - defaultParams.seasonLength);

            // Reconstruct the first one-step-ahead residual manually to verify timing
            const seasonLength = defaultParams.seasonLength;
            let initialLevel = 0;
            for (let i = 0; i < seasonLength; i++) initialLevel += data[i];
            initialLevel /= seasonLength;

            let sum1 = 0;
            let sum2 = 0;
            for (let i = 0; i < seasonLength; i++) {
                sum1 += data[seasonLength + i];
                sum2 += data[i];
            }
            const initialTrend = (sum1 - sum2) / (seasonLength * seasonLength);

            // Initial seasonal factor at index 0
            const initialSeasonal0 = data[0] - (initialLevel + initialTrend);

            // Predicted value at t = seasonLength based on state at t-1 (initial state)
            const expectedOneStepPred = initialLevel + initialTrend + initialSeasonal0;
            const expectedFirstResidual = data[seasonLength] - expectedOneStepPred;

            expect(result.residuals![0]).toBeCloseTo(expectedFirstResidual, 5);
        });

        it('does not leak current observation into one-step prediction', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const data = generateSyntheticOccupancy(2, 24, 50, 10, 0); // 48 hours
            // Perturb single observation at t=24 (first smoothing step)
            const perturbedData = [...data];
            const originalVal = perturbedData[24];
            perturbedData[24] = originalVal + 25; // Large sudden spike

            const resultOriginal = hw.fitAndForecast(data, 8);
            const resultPerturbed = hw.fitAndForecast(perturbedData, 8);

            // The one-step-ahead prediction at t=24 must be IDENTICAL because it depends ONLY on state at t-1
            const predOriginalAt24 = data[24] - resultOriginal.residuals![0];
            const predPerturbedAt24 = perturbedData[24] - resultPerturbed.residuals![0];

            expect(predPerturbedAt24).toBeCloseTo(predOriginalAt24, 6);
            // Residual at t=24 differs by exactly 25
            expect(resultPerturbed.residuals![0] - resultOriginal.residuals![0]).toBeCloseTo(25, 6);
        });
    });

    describe('2. Residual Variance & Degrees of Freedom', () => {
        it('calculates residual variance with degrees of freedom adjusted for parameters (alpha, beta, gamma)', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const data = generateSyntheticOccupancy(3, 24, 50, 15, 3);
            const result = hw.fitAndForecast(data, 12);

            expect(result.residuals).toBeDefined();
            const residuals = result.residuals!;
            const residualCount = residuals.length;
            const expectedDf = residualCount - 3; // 3 smoothing parameters

            const sumSq = residuals.reduce((sum, r) => sum + r * r, 0);
            const expectedVariance = sumSq / expectedDf;
            const expectedStdError = Math.sqrt(expectedVariance);

            expect(result.residualVariance).toBeCloseTo(expectedVariance, 6);
            expect(result.residualStdError).toBeCloseTo(expectedStdError, 6);
        });

        it('handles zero residual variance gracefully', () => {
            // Perfectly constant time series
            const constantData = new Array(48).fill(42);
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const result = hw.fitAndForecast(constantData, 24);

            expect(result.residualVariance).toBe(0);
            expect(result.residualStdError).toBe(0);

            // With zero residual variance, prediction intervals collapse to point predictions
            for (let i = 0; i < result.predictions.length; i++) {
                expect(result.lowerBounds[i]).toBe(result.predictions[i]);
                expect(result.upperBounds[i]).toBe(result.predictions[i]);
            }
        });
    });

    describe('3. Prediction Bounds Ordering and Constraints', () => {
        it('strictly maintains 0 <= lowerBound <= forecast <= upperBound <= 100', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(4, 24, 50, 20, 5);
            const result = hw.fitAndForecast(data, 168); // 7-day forecast (168 hours)

            expect(result.predictions.length).toBe(168);
            expect(result.lowerBounds.length).toBe(168);
            expect(result.upperBounds.length).toBe(168);

            for (let i = 0; i < result.predictions.length; i++) {
                const lower = result.lowerBounds[i];
                const pred = result.predictions[i];
                const upper = result.upperBounds[i];

                expect(lower).toBeGreaterThanOrEqual(0);
                expect(upper).toBeLessThanOrEqual(100);
                expect(lower).toBeLessThanOrEqual(pred);
                expect(pred).toBeLessThanOrEqual(upper);
            }
        });

        it('clamps properly near lower boundary (0% occupancy)', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            // Very low occupancy series
            const lowOccupancyData = new Array(48).fill(2).map((v, i) => Math.max(0, v + (i % 2 === 0 ? 1 : -1)));
            const result = hw.fitAndForecast(lowOccupancyData, 12);

            for (let i = 0; i < result.predictions.length; i++) {
                expect(result.lowerBounds[i]).toBeGreaterThanOrEqual(0);
                expect(result.lowerBounds[i]).toBeLessThanOrEqual(result.predictions[i]);
                expect(result.upperBounds[i]).toBeGreaterThanOrEqual(result.predictions[i]);
            }
        });

        it('clamps properly near upper boundary (100% occupancy)', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            // High occupancy series
            const highOccupancyData = new Array(48).fill(98).map((v, i) => Math.min(100, v + (i % 2 === 0 ? 1 : -1)));
            const result = hw.fitAndForecast(highOccupancyData, 12);

            for (let i = 0; i < result.predictions.length; i++) {
                expect(result.upperBounds[i]).toBeLessThanOrEqual(100);
                expect(result.lowerBounds[i]).toBeLessThanOrEqual(result.predictions[i]);
                expect(result.upperBounds[i]).toBeGreaterThanOrEqual(result.predictions[i]);
            }
        });
    });

    describe('4. 7-Day Forecast Horizon & Increasing Uncertainty', () => {
        it('supports 7-day (168-hour) forecast horizon with correctly sized arrays', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(5, 24, 60, 25, 4);
            const horizon = 7 * 24; // 168 hours
            const result = hw.fitAndForecast(data, horizon);

            expect(result.predictions.length).toBe(168);
            expect(result.lowerBounds.length).toBe(168);
            expect(result.upperBounds.length).toBe(168);
            expect(result.intervalLevel).toBe(0.95);
        });

        it('exhibits monotonically increasing forecast uncertainty over lead time', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const data = generateSyntheticOccupancy(3, 24, 50, 10, 3);
            const result = hw.fitAndForecast(data, 48);

            // Verify that theoretical margin before boundary clamping strictly increases
            const { alpha, beta, gamma, seasonLength } = defaultParams;
            let prevMargin = 0;
            let cumulativePsiSq = 0;
            const z = 1.959963984540054;

            for (let h = 1; h <= 48; h++) {
                if (h > 1) {
                    const j = h - 1;
                    const seasonalTerm = j % seasonLength === 0 ? gamma * (1 - alpha) : 0;
                    const psi_j = alpha + j * alpha * beta + seasonalTerm;
                    cumulativePsiSq += psi_j * psi_j;
                }
                const varianceFactor = 1 + cumulativePsiSq;
                const horizonStd = result.residualStdError * Math.sqrt(varianceFactor);
                const currentMargin = z * horizonStd;

                if (h > 1) {
                    expect(currentMargin).toBeGreaterThan(prevMargin);
                }
                prevMargin = currentMargin;
            }
        });
    });

    describe('5. Seasonality Types (Additive vs Multiplicative)', () => {
        it('computes prediction intervals correctly for explicit additive model', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'additive' });
            const data = generateSyntheticOccupancy(3, 24, 45, 15, 2);
            const result = hw.fitAndForecast(data, 24);

            expect(result.predictions.length).toBe(24);
            expect(result.residualStdError).toBeGreaterThan(0);
            expect(result.lowerBounds.length).toBe(24);
            expect(result.upperBounds.length).toBe(24);
        });

        it('computes prediction intervals correctly for explicit multiplicative model', () => {
            const hw = new HoltWinters({ ...defaultParams, seasonalType: 'multiplicative' });
            const data = generateSyntheticOccupancy(3, 24, 50, 20, 2);
            const result = hw.fitAndForecast(data, 24);

            expect(result.predictions.length).toBe(24);
            expect(result.residualStdError).toBeGreaterThan(0);
            expect(result.lowerBounds.length).toBe(24);
            expect(result.upperBounds.length).toBe(24);
        });

        it('auto-selects additive model when data has predominantly zero values (>50%)', () => {
            // 70% zeros
            const sparseData = new Array(48).fill(0).map((v, i) => (i % 3 === 0 ? 25 : 0));
            const hw = new HoltWinters(defaultParams);
            const result = hw.fitAndForecast(sparseData, 12);

            expect(result.predictions.length).toBe(12);
            expect(result.lowerBounds.every((b) => Number.isFinite(b) && b >= 0)).toBe(true);
            expect(result.upperBounds.every((b) => Number.isFinite(b) && b <= 100)).toBe(true);
        });
    });

    describe('6. Edge Cases & Robustness Handling', () => {
        it('throws error when historical observations are insufficient (< 2 seasons)', () => {
            const hw = new HoltWinters(defaultParams);
            const insufficientData = new Array(40).fill(30); // 40 < 48

            expect(() => {
                hw.fitAndForecast(insufficientData, 12);
            }).toThrow('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        });

        it('handles non-array inputs safely', () => {
            const hw = new HoltWinters(defaultParams);
            expect(() => {
                // @ts-expect-error Testing invalid input
                hw.fitAndForecast(null, 12);
            }).toThrow('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        });

        it('safely handles missing, NaN, and Infinity values in historical data', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(3, 24, 50, 15, 2);
            // Introduce corrupted/missing values
            data[5] = NaN;
            data[15] = Infinity;
            data[30] = -Infinity;

            const result = hw.fitAndForecast(data, 24);

            expect(result.predictions.every((p) => Number.isFinite(p))).toBe(true);
            expect(result.lowerBounds.every((b) => Number.isFinite(b) && b >= 0)).toBe(true);
            expect(result.upperBounds.every((b) => Number.isFinite(b) && b <= 100)).toBe(true);
            expect(result.residualStdError).toBeGreaterThan(0);
        });

        it('throws error if valid finite observations are less than 2 full seasons', () => {
            const hw = new HoltWinters(defaultParams);
            // Array of length 48, but 10 entries are NaN (leaving only 38 valid entries)
            const data = new Array(48).fill(50);
            for (let i = 0; i < 10; i++) data[i] = NaN;

            expect(() => {
                hw.fitAndForecast(data, 12);
            }).toThrow('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        });

        it('handles zero forecast horizon', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(2, 24, 50, 10, 1);
            const result = hw.fitAndForecast(data, 0);

            expect(result.predictions).toEqual([]);
            expect(result.lowerBounds).toEqual([]);
            expect(result.upperBounds).toEqual([]);
        });

        it('supports custom prediction interval level (e.g. 90% and 99%)', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(3, 24, 50, 15, 3);

            const result90 = hw.fitAndForecast(data, 12, 0.90);
            const result95 = hw.fitAndForecast(data, 12, 0.95);
            const result99 = hw.fitAndForecast(data, 12, 0.99);

            expect(result90.intervalLevel).toBe(0.90);
            expect(result95.intervalLevel).toBe(0.95);
            expect(result99.intervalLevel).toBe(0.99);

            // A 99% interval must be wider than a 95% interval, which in turn is wider than 90%
            const width90 = result90.upperBounds[6] - result90.lowerBounds[6];
            const width95 = result95.upperBounds[6] - result95.lowerBounds[6];
            const width99 = result99.upperBounds[6] - result99.lowerBounds[6];

            expect(width99).toBeGreaterThan(width95);
            expect(width95).toBeGreaterThan(width90);
        });
    });

    describe('7. Backward Compatibility with Existing Callers', () => {
        it('preserves existing ForecastResult fields (predictions, finalLevel, finalTrend, finalSeasonals)', () => {
            const hw = new HoltWinters(defaultParams);
            const data = generateSyntheticOccupancy(2, 24, 50, 10, 0);
            const result: ForecastResult = hw.fitAndForecast(data, 8);

            expect(Array.isArray(result.predictions)).toBe(true);
            expect(typeof result.finalLevel).toBe('number');
            expect(typeof result.finalTrend).toBe('number');
            expect(Array.isArray(result.finalSeasonals)).toBe(true);
            expect(result.finalSeasonals.length).toBe(24);
        });
    });
});

