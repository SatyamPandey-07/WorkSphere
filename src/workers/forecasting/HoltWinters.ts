/**
 * HoltWinters.ts
 * Implementation of the Holt-Winters triple exponential smoothing algorithm for time-series forecasting.
 * Accounts for level, trend, and daily seasonality in venue occupancy data.
 */

export interface HoltWintersParams {
    alpha: number; // Level smoothing (0-1)
    beta: number;  // Trend smoothing (0-1)
    gamma: number; // Seasonality smoothing (0-1)
    seasonLength: number; // Number of periods in a season (e.g., 24 for hourly daily data)
}

export interface ForecastResult {
    predictions: number[];
    finalLevel: number;
    finalTrend: number;
    finalSeasonals: number[];
}

export class HoltWinters {
    private params: HoltWintersParams;

    constructor(params: HoltWintersParams) {
        this.params = params;
    }

    /**
     * Fits the model to historical data and forecasts future periods.
     * @param data Historical time-series data points.
     * @param forecastHorizon Number of future periods to predict.
     */
    public fitAndForecast(data: number[], forecastHorizon: number): ForecastResult {
        const { alpha, beta, gamma, seasonLength } = this.params;
        const n = data.length;

        if (n < seasonLength * 2) {
            throw new Error('Insufficient data for seasonality detection. Need at least 2 full seasons.');
        }

        // Initialize level, trend, and seasonal components
        let level = this.calculateInitialLevel(data, seasonLength);
        let trend = this.calculateInitialTrend(data, seasonLength);
        const seasonals = this.calculateInitialSeasonals(data, seasonLength, level, trend);

        // Smoothing phase
        for (let t = seasonLength; t < n; t++) {
            const prevLevel = level;
            const seasonalIndex = t % seasonLength;

            // Update level
            level = alpha * (data[t] / seasonals[seasonalIndex]) + (1 - alpha) * (prevLevel + trend);

            // Update trend
            trend = beta * (level - prevLevel) + (1 - beta) * trend;

            // Update seasonal component
            seasonals[seasonalIndex] = gamma * (data[t] / level) + (1 - gamma) * seasonals[seasonalIndex];
        }

        // Forecasting phase
        const predictions: number[] = [];
        for (let h = 1; h <= forecastHorizon; h++) {
            const seasonalIndex = (n + h - 1) % seasonLength;
            const forecast = (level + h * trend) * seasonals[seasonalIndex];
            predictions.push(Math.max(0, Math.min(100, forecast))); // Clamp to 0-100% occupancy
        }

        return {
            predictions,
            finalLevel: level,
            finalTrend: trend,
            finalSeasonals: [...seasonals]
        };
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

    private calculateInitialSeasonals(data: number[], seasonLength: number, initialLevel: number, initialTrend: number): number[] {
        const seasonals = new Array(seasonLength).fill(0);
        for (let i = 0; i < seasonLength; i++) {
            seasonals[i] = data[i] / (initialLevel + (i + 1) * initialTrend);
        }
        return seasonals;
    }
}
