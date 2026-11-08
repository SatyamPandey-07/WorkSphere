/**
 * HoltWinters.ts
 * Implementation of the Holt-Winters triple exponential smoothing algorithm for time-series forecasting.
 * Accounts for level, trend, and daily seasonality in venue occupancy data.
 * Computes 95% prediction intervals (confidence bands) based on residual error variance.
 */

export interface HoltWintersParams {
    alpha: number; // Level smoothing (0-1)
    beta: number;  // Trend smoothing (0-1)
    gamma: number; // Seasonality smoothing (0-1)
    seasonLength: number; // Number of periods in a season (e.g., 24 for hourly daily data)
    seasonalType?: 'multiplicative' | 'additive';
    intervalLevel?: number; // Prediction interval confidence level, default 0.95 (95%)
}

export interface ForecastResult {
    predictions: number[];
    finalLevel: number;
    finalTrend: number;
    finalSeasonals: number[];
    lowerBounds: number[];
    upperBounds: number[];
    residualStdError: number;
    residualVariance?: number;
    residuals?: number[];
    intervalLevel: number;
}

const EPSILON = 1e-6;

export class HoltWinters {
    private params: HoltWintersParams;

    constructor(params: HoltWintersParams) {
        this.params = params;
    }

    /**
     * Fits the model to historical data and forecasts future periods.
     * Computes 95% prediction intervals derived from one-step-ahead residual variance
     * and model-specific forecast error accumulation over the forecast horizon.
     *
     * @param data Historical time-series data points.
     * @param forecastHorizon Number of future periods to predict.
     * @param intervalLevel Optional confidence level override (defaults to params.intervalLevel or 0.95).
     */
    public fitAndForecast(
        data: number[],
        forecastHorizon: number,
        intervalLevel?: number
    ): ForecastResult {
        const { alpha, beta, gamma, seasonLength } = this.params;
        const n = data ? data.length : 0;

        if (!Array.isArray(data) || n < seasonLength * 2) {
            throw new Error('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        }

        // Validate and sanitize data to handle missing or invalid historical observations safely
        const validIndices: number[] = [];
        for (let i = 0; i < n; i++) {
            if (typeof data[i] === 'number' && Number.isFinite(data[i])) {
                validIndices.push(i);
            }
        }

        if (validIndices.length < seasonLength * 2) {
            throw new Error('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        }

        const sanitizedData = new Array<number>(n);
        let lastValid = data[validIndices[0]];
        for (let i = 0; i < n; i++) {
            const v = data[i];
            if (typeof v === 'number' && Number.isFinite(v)) {
                sanitizedData[i] = v;
                lastValid = v;
            } else {
                sanitizedData[i] = lastValid;
            }
        }

        // Detect if the historical series is largely zero-valued to choose additive fallback
        const zeroCount = sanitizedData.filter((v) => v === 0).length;
        const isPredominantlyZero = zeroCount / n > 0.5;
        const seasonalType =
            this.params.seasonalType ?? (isPredominantlyZero ? 'additive' : 'multiplicative');

        // Initialize level, trend, and seasonal components
        let level = this.calculateInitialLevel(sanitizedData, seasonLength);
        let trend = this.calculateInitialTrend(sanitizedData, seasonLength);
        const seasonals = this.calculateInitialSeasonals(
            sanitizedData,
            seasonLength,
            level,
            trend,
            seasonalType
        );

        // Smoothing phase: compute one-step-ahead predictions, residuals, and state updates
        const residuals: number[] = [];
        for (let t = seasonLength; t < n; t++) {
            const prevLevel = level;
            const seasonalIndex = t % seasonLength;

            // 1. One-step-ahead prediction using model state at t-1 (prevents information leakage)
            const oneStepPred =
                seasonalType === 'additive'
                    ? prevLevel + trend + seasonals[seasonalIndex]
                    : (prevLevel + trend) * seasonals[seasonalIndex];

            // 2. Residual calculation: actual observed value minus one-step prediction
            const isObserved = typeof data[t] === 'number' && Number.isFinite(data[t]);
            if (isObserved && Number.isFinite(oneStepPred)) {
                const residual = data[t] - oneStepPred;
                if (Number.isFinite(residual)) {
                    residuals.push(residual);
                }
            }

            // 3. State update using observation (or sanitized observation)
            const yt = sanitizedData[t];
            if (seasonalType === 'additive') {
                // Additive formulation
                level = alpha * (yt - seasonals[seasonalIndex]) + (1 - alpha) * (prevLevel + trend);
                trend = beta * (level - prevLevel) + (1 - beta) * trend;
                seasonals[seasonalIndex] =
                    gamma * (yt - level) + (1 - gamma) * seasonals[seasonalIndex];
            } else {
                // Multiplicative formulation with EPSILON smoothing against zero divisors
                const safeSeasonal = Math.abs(seasonals[seasonalIndex]) < EPSILON ? EPSILON : seasonals[seasonalIndex];
                level = alpha * (yt / safeSeasonal) + (1 - alpha) * (prevLevel + trend);
                trend = beta * (level - prevLevel) + (1 - beta) * trend;

                const safeLevel = Math.abs(level) < EPSILON ? EPSILON : level;
                seasonals[seasonalIndex] =
                    gamma * (yt / safeLevel) + (1 - gamma) * seasonals[seasonalIndex];
            }
        }

        // Estimate residual variance with degrees of freedom adjusted for smoothing parameters (alpha, beta, gamma)
        const residualCount = residuals.length;
        let residualVariance = 0;
        let residualStdError = 0;

        if (residualCount > 0) {
            const df = residualCount > 3 ? residualCount - 3 : Math.max(1, residualCount - 1);
            const sumSqResiduals = residuals.reduce((sum, r) => sum + r * r, 0);
            residualVariance = sumSqResiduals / df;
            residualStdError =
                Number.isFinite(residualVariance) && residualVariance > 0
                    ? Math.sqrt(residualVariance)
                    : 0;
        }

        // Determine critical value z for the prediction interval level
        const effectiveLevel = intervalLevel ?? this.params.intervalLevel ?? 0.95;
        const z = this.calculateNormalQuantile(effectiveLevel);

        // Forecasting phase: calculate point forecasts and 95% prediction intervals
        const predictions: number[] = [];
        const lowerBounds: number[] = [];
        const upperBounds: number[] = [];
        let cumulativePsiSq = 0;

        for (let h = 1; h <= forecastHorizon; h++) {
            const seasonalIndex = (n + h - 1) % seasonLength;
            const rawForecast =
                seasonalType === 'additive'
                    ? level + h * trend + seasonals[seasonalIndex]
                    : (level + h * trend) * seasonals[seasonalIndex];

            const forecast = Number.isFinite(rawForecast) ? rawForecast : 0;
            const clampedForecast = Math.max(0, Math.min(100, forecast)); // Clamp to 0-100% occupancy
            predictions.push(clampedForecast);

            // Accumulate forecast error variance multiplier c_h^2 for lead time h
            // For Holt-Winters state-space models: psi_j = alpha + j*alpha*beta + gamma*(1-alpha)*I(j % seasonLength == 0)
            if (h > 1) {
                const j = h - 1;
                const seasonalTerm = j % seasonLength === 0 ? gamma * (1 - alpha) : 0;
                const psi_j = alpha + j * alpha * beta + seasonalTerm;
                cumulativePsiSq += psi_j * psi_j;
            }

            const varianceFactor = 1 + cumulativePsiSq;
            const horizonStdError = residualStdError * Math.sqrt(varianceFactor);
            const margin = z * horizonStdError;

            // Prediction bounds clamped to [0, 100] while strictly preserving lower <= forecast <= upper
            const lower = Number.isFinite(margin)
                ? Math.max(0, Math.min(clampedForecast, clampedForecast - margin))
                : clampedForecast;
            const upper = Number.isFinite(margin)
                ? Math.min(100, Math.max(clampedForecast, clampedForecast + margin))
                : clampedForecast;

            lowerBounds.push(lower);
            upperBounds.push(upper);
        }

        return {
            predictions,
            finalLevel: Number.isFinite(level) ? level : 0,
            finalTrend: Number.isFinite(trend) ? trend : 0,
            finalSeasonals: [...seasonals],
            lowerBounds,
            upperBounds,
            residualStdError,
            residualVariance,
            residuals,
            intervalLevel: effectiveLevel,
        };
    }

    /**
     * Rational approximation of the standard normal inverse cumulative distribution function (probit).
     * Yields the critical z-score corresponding to a two-sided prediction interval.
     */
    private calculateNormalQuantile(level: number): number {
        const p = Math.max(0.5, Math.min(0.999, level));
        if (Math.abs(p - 0.95) < 1e-4) {
            return 1.959963984540054;
        }

        // Two-sided critical value: probability in upper tail is (1 - p) / 2
        const prob = 1 - (1 - p) / 2;
        const t = Math.sqrt(-2 * Math.log(1 - prob));
        const c0 = 2.515517;
        const c1 = 0.802853;
        const c2 = 0.010328;
        const d1 = 1.432788;
        const d2 = 0.189269;
        const d3 = 0.001308;
        return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
    }

    private calculateInitialLevel(data: number[], seasonLength: number): number {
        let sum = 0;
        for (let i = 0; i < seasonLength; i++) {
            sum += data[i];
        }
        return sum / seasonLength;
    }

    private calculateInitialTrend(data: number[], seasonLength: number): number {
        let sum1 = 0;
        let sum2 = 0;
        for (let i = 0; i < seasonLength; i++) {
            sum1 += data[seasonLength + i];
            sum2 += data[i];
        }
        return (sum1 - sum2) / (seasonLength * seasonLength);
    }

    private calculateInitialSeasonals(
        data: number[],
        seasonLength: number,
        initialLevel: number,
        initialTrend: number,
        seasonalType: 'multiplicative' | 'additive'
    ): number[] {
        const seasonals = new Array(seasonLength).fill(0);
        for (let i = 0; i < seasonLength; i++) {
            const baseline = initialLevel + (i + 1) * initialTrend;
            if (seasonalType === 'additive') {
                seasonals[i] = data[i] - baseline;
            } else {
                const safeBaseline = Math.abs(baseline) < EPSILON ? EPSILON : baseline;
                seasonals[i] = data[i] / safeBaseline;
            }
        }
        return seasonals;
    }
}
