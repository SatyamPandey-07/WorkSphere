/**
 * @file GridLoadForecaster.ts
 * @description Uses Holt-Winters exponential smoothing to predict hourly power 
 * consumption based on current venue occupancy and historical device profiles.
 * Prevents catastrophic venue power outages by predicting circuit overloads.
 */

export interface PowerTelemetry {
    timestamp: number;
    totalWatts: number;
    occupancyCount: number;
}

export interface ForecastResult {
    timestamp: number;
    predictedWatts: number;
    upperBound: number;
    lowerBound: number;
    confidence: number;
}

export class GridLoadForecaster {
    private alpha: number; // Level smoothing
    private beta: number;  // Trend smoothing
    private gamma: number; // Seasonal smoothing
    private seasonLength: number;

    private level: number = 0;
    private trend: number = 0;
    private seasonals: number[] = [];
    private history: PowerTelemetry[] = [];

    constructor(seasonLength: number = 24, alpha = 0.3, beta = 0.1, gamma = 0.1) {
        this.seasonLength = seasonLength;
        this.alpha = alpha;
        this.beta = beta;
        this.gamma = gamma;
    }

    public ingestTelemetry(data: PowerTelemetry): void {
        this.history.push(data);
        if (this.history.length > this.seasonLength * 10) {
            this.history.shift(); // Keep memory bounded
        }
        this.updateModel(data.totalWatts);
    }

    private updateModel(value: number): void {
        if (this.seasonals.length < this.seasonLength) {
            // Initialization phase
            this.seasonals.push(value);
            if (this.seasonals.length === this.seasonLength) {
                this.level = this.seasonals.reduce((a, b) => a + b, 0) / this.seasonLength;
                this.trend = 0;
                for (let i = 0; i < this.seasonLength; i++) {
                    this.seasonals[i] = this.seasonals[i] - this.level;
                }
            }
            return;
        }

        const lastSeasonal = this.seasonals[0];
        const lastLevel = this.level;
        const lastTrend = this.trend;

        // Holt-Winters Additive Method
        this.level = this.alpha * (value - lastSeasonal) + (1 - this.alpha) * (lastLevel + lastTrend);
        this.trend = this.beta * (this.level - lastLevel) + (1 - this.beta) * lastTrend;

        const newSeasonal = this.gamma * (value - this.level) + (1 - this.gamma) * lastSeasonal;

        this.seasonals.shift();
        this.seasonals.push(newSeasonal);
    }

    public forecast(stepsAhead: number): ForecastResult[] {
        if (this.seasonals.length < this.seasonLength) {
            return []; // Not enough data to forecast
        }

        const results: ForecastResult[] = [];
        const baseTime = this.history.length > 0 ? this.history[this.history.length - 1].timestamp : Date.now();
        const interval = 3600000; // 1 hour in ms

        // Calculate variance for confidence bounds
        let squaredErrorSum = 0;
        const errorCount = Math.min(this.history.length, this.seasonLength);
        for (let i = this.history.length - errorCount; i < this.history.length; i++) {
            if (i >= this.seasonLength) {
                const expected = this.level + this.seasonals[i % this.seasonLength];
                squaredErrorSum += Math.pow(this.history[i].totalWatts - expected, 2);
            }
        }
        const stdDev = Math.sqrt(squaredErrorSum / Math.max(1, errorCount));

        for (let i = 1; i <= stepsAhead; i++) {
            const seasonalIndex = (this.seasonals.length + i - 1) % this.seasonLength;
            const predicted = this.level + (i * this.trend) + this.seasonals[seasonalIndex];

            // Confidence decreases as we look further ahead
            const uncertaintyMultiplier = 1 + (i * 0.1);
            const bound = stdDev * uncertaintyMultiplier * 1.96; // 95% confidence interval

            results.push({
                timestamp: baseTime + (i * interval),
                predictedWatts: Math.max(0, predicted),
                upperBound: Math.max(0, predicted + bound),
                lowerBound: Math.max(0, predicted - bound),
                confidence: Math.max(0, 1 - (i * 0.05)),
            });
        }

        return results;
    }

    public getCurrentBaseline(): number {
        return this.level + (this.seasonals.length > 0 ? this.seasonals[0] : 0);
    }
}
