/**
 * DemandCurvePredictor.ts
 * Uses Holt-Winters exponential smoothing to forecast hourly demand based on historical booking data.
 * Accounts for level, trend, and seasonality to predict future desk occupancy.
 */

import {
    EventCorrelationMatrix,
    CorrelatedEvent,
    ExternalFactors
} from './EventCorrelationMatrix';

export interface HistoricalDataPoint {
    timestamp: number;
    demand: number;
}

export class DemandCurvePredictor {
    private alpha: number; // Level smoothing
    private beta: number;  // Trend smoothing
    private gamma: number; // Seasonality smoothing
    private seasonLength: number;
    private minMultiplier: number;
    private maxMultiplier: number;

    constructor(
        alpha: number = 0.3,
        beta: number = 0.1,
        gamma: number = 0.1,
        seasonLength: number = 24,
        minMultiplier: number = 0.5,
        maxMultiplier: number = 3.0
    ) {
        this.alpha = alpha;
        this.beta = beta;
        this.gamma = gamma;
        this.seasonLength = seasonLength;
        this.minMultiplier = minMultiplier;
        this.maxMultiplier = maxMultiplier;
    }

    /**
     * Evaluates correlated event multipliers with cycle detection (visited set)
     * and safe bounds clamping to prevent RangeError: Maximum call stack size exceeded.
     */
    public evaluateEventCorrelations(
        eventId: string,
        events: Record<string, CorrelatedEvent> | Map<string, CorrelatedEvent>,
        visited: Set<string> = new Set()
    ): number {
        if (visited.has(eventId)) {
            // Cycle detected: prevent recursive evaluation loop
            return 1.0;
        }

        const event = events instanceof Map ? events.get(eventId) : events[eventId];
        if (!event) return 1.0;

        visited.add(eventId);

        let multiplier = event.multiplier ?? 1.0;

        if (Array.isArray(event.correlatedEvents)) {
            for (const targetId of event.correlatedEvents) {
                if (!visited.has(targetId)) {
                    multiplier *= this.evaluateEventCorrelations(targetId, events, visited);
                }
            }
        }

        // Clamp cumulative multiplier to safe operational bounds
        return Math.max(this.minMultiplier, Math.min(this.maxMultiplier, multiplier));
    }

    /**
     * Forecasts demand and adjusts for correlated external events with cycle detection.
     */
    public forecastWithCorrelatedEvents(
        data: HistoricalDataPoint[],
        periodsToForecast: number,
        factors: ExternalFactors,
        events: CorrelatedEvent[] = [],
        correlationMatrix: EventCorrelationMatrix = new EventCorrelationMatrix(this.minMultiplier, this.maxMultiplier)
    ): number[] {
        const baseForecast = this.forecast(data, periodsToForecast);
        return correlationMatrix.adjustDemandForecast(baseForecast, factors, events);
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
