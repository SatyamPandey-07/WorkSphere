/**
 * DepletionForecaster.ts
 * Uses advanced time-series forecasting to predict inventory run-out times, 
 * factoring in day-of-week seasonality and local events.
 */

export interface InventoryItem {
    sku: string;
    name: string;
    currentStock: number;
    unit: string; // e.g., 'liters', 'kg', 'units'
    historicalUsage: number[]; // Hourly usage for the past 7 days (168 data points)
}

export interface ForecastResult {
    sku: string;
    estimatedHoursToDepletion: number;
    depletionTimestamp: number;
    confidence: number; // 0.0 to 1.0
    trend: 'INCREASING' | 'STABLE' | 'DECREASING';
    recommendedOrderQty: number;
}

export class DepletionForecaster {
    private items: Map<string, InventoryItem> = new Map();
    private localEvents: { timestamp: number; impactMultiplier: number }[] = [];

    public updateItem(item: InventoryItem): void {
        this.items.set(item.sku, item);
    }

    public registerLocalEvent(timestamp: number, impactMultiplier: number): void {
        this.localEvents.push({ timestamp, impactMultiplier });
    }

    /**
     * Applies Holt-Winters Triple Exponential Smoothing to forecast usage.
     */
    public forecast(sku: string, forecastHorizonHours: number = 24): ForecastResult | null {
        const item = this.items.get(sku);
        if (!item || item.historicalUsage.length < 24) return null;

        const data = item.historicalUsage;
        const seasonLength = 24; // Daily seasonality (24 hours)

        // Holt-Winters parameters
        const alpha = 0.3; // Level smoothing
        const beta = 0.1;  // Trend smoothing
        const gamma = 0.5; // Seasonal smoothing

        let level = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
        let trend = (data.slice(seasonLength, 2 * seasonLength).reduce((a, b) => a + b, 0) / seasonLength) - level;

        let seasonals = new Array(seasonLength).fill(0);
        for (let i = 0; i < seasonLength; i++) {
            seasonals[i] = data[i] / level;
        }

        // Run smoothing over historical data
        for (let i = 0; i < data.length; i++) {
            const val = data[i];
            const lastLevel = level;

            level = alpha * (val / seasonals[i % seasonLength]) + (1 - alpha) * (level + trend);
            trend = beta * (level - lastLevel) + (1 - beta) * trend;
            seasonals[i % seasonLength] = gamma * (val / level) + (1 - gamma) * seasonals[i % seasonLength];
        }

        // Forecast future usage
        let forecastedUsage = 0;
        let hoursToDepletion = 0;
        let remainingStock = item.currentStock;

        for (let h = 1; h <= forecastHorizonHours; h++) {
            const seasonIdx = (data.length + h - 1) % seasonLength;
            let expectedUsage = (level + h * trend) * seasonals[seasonIdx];

            // Apply local event impact
            const futureTime = Date.now() + h * 3600000;
            for (const event of this.localEvents) {
                if (Math.abs(event.timestamp - futureTime) < 3600000) {
                    expectedUsage *= event.impactMultiplier;
                }
            }

            expectedUsage = Math.max(0, expectedUsage); // Usage cannot be negative
            forecastedUsage += expectedUsage;

            remainingStock -= expectedUsage;
            if (remainingStock <= 0 && hoursToDepletion === 0) {
                hoursToDepletion = h;
            }
        }

        const avgUsage = data.reduce((a, b) => a + b, 0) / data.length;
        const trendDirection = trend > 0.1 ? 'INCREASING' : (trend < -0.1 ? 'DECREASING' : 'STABLE');

        // Calculate confidence based on variance of historical data
        const variance = data.reduce((sum, val) => sum + Math.pow(val - avgUsage, 2), 0) / data.length;
        const stdDev = Math.sqrt(variance);
        const confidence = Math.max(0, 1 - (stdDev / (avgUsage + 1)));

        return {
            sku,
            estimatedHoursToDepletion: hoursToDepletion || forecastHorizonHours + 1,
            depletionTimestamp: Date.now() + (hoursToDepletion * 3600000),
            confidence,
            trend: trendDirection,
            recommendedOrderQty: Math.ceil(avgUsage * 48) // Order 2 days worth of stock
        };
    }

    public getCriticalItems(thresholdHours: number = 12): ForecastResult[] {
        const critical: ForecastResult[] = [];

        for (const sku of this.items.keys()) {
            const forecast = this.forecast(sku);
            if (forecast && forecast.estimatedHoursToDepletion <= thresholdHours) {
                critical.push(forecast);
            }
        }

        return critical.sort((a, b) => a.estimatedHoursToDepletion - b.estimatedHoursToDepletion);
    }
}