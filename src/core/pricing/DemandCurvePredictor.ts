/**
 * DemandCurvePredictor.ts
 * Uses Holt-Winters exponential smoothing to forecast hourly demand based on historical booking data.
 * Accounts for level, trend, and seasonality to predict future desk occupancy.
 */

export interface HistoricalDataPoint {
    timestamp: number;
    demand: number;
}

export class DemandCurvePredictor {
    private alpha: number; // Level smoothing
    private beta: number;  // Trend smoothing
    private gamma: number; // Seasonality smoothing
    private seasonLength: number;

    constructor(alpha: number = 0.3, beta: number = 0.1, gamma: number = 0.1, seasonLength: number = 24) {
        this.alpha = alpha;
        this.beta = beta;
        this.gamma = gamma;
        this.seasonLength = seasonLength;
    }

    public forecast(data: HistoricalDataPoint[], periodsToForecast: number): number[] {
        if (data.length < this.seasonLength * 2) {
            throw new Error('Insufficient historical data for seasonal forecasting');
        }

        const n = data.length;
        const level = new Array(n).fill(0);
        const trend = new Array(n).fill(0);
        const seasonal = new Array(n).fill(0);

        // Initialize level and trend
        level[0] = data[0].demand;
        trend[0] = (data[this.seasonLength].demand - data[0].demand) / this.seasonLength;

        // Initialize seasonal indices
        for (let i = 0; i < this.seasonLength; i++) {
            seasonal[i] = data[i].demand - level[0];
        }

        // Calculate smoothed values
        for (let t = 1; t < n; t++) {
            const s = t % this.seasonLength;
            level[t] = this.alpha * (data[t].demand - seasonal[t - this.seasonLength] || 0) +
                (1 - this.alpha) * (level[t - 1] + trend[t - 1]);
            trend[t] = this.beta * (level[t] - level[t - 1]) + (1 - this.beta) * trend[t - 1];
            seasonal[t] = this.gamma * (data[t].demand - level[t]) +
                (1 - this.gamma) * (seasonal[t - this.seasonLength] || seasonal[s]);
        }

        // Forecast future periods
        const forecasts: number[] = [];
        const lastLevel = level[n - 1];
        const lastTrend = trend[n - 1];

        for (let h = 1; h <= periodsToForecast; h++) {
            const s = (n - 1 + h) % this.seasonLength;
            const forecastValue = lastLevel + h * lastTrend + (seasonal[n - this.seasonLength + s] || 0);
            forecasts.push(Math.max(0, forecastValue)); // Demand cannot be negative
        }

        return forecasts;
    }
}
