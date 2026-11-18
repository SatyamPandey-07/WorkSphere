/**
 * PredictorEngine.ts
 * The main worker orchestrator that schedules periodic forecast recalculations and emits events 
 * to the main thread with updated occupancy predictions.
 */

import { HoltWinters } from './HoltWinters';
import { TimeSeriesStore } from './TimeSeriesStore';

interface ForecastRequest {
    venueId: string;
    historicalData: number[];
    forecastHours: number;
}

export class PredictorEngine {
    private stores: Map<string, TimeSeriesStore>;
    private forecastInterval: ReturnType<typeof setInterval> | null = null;
    private readonly FORECAST_HORIZON = 8; // Predict next 8 hours

    constructor() {
        this.stores = new Map();
    }

    public initialize(venueIds: string[]): void {
        for (const id of venueIds) {
            if (!this.stores.has(id)) {
                this.stores.set(id, new TimeSeriesStore(168)); // 1 week hourly buffer
            }
        }
        this.startForecastLoop();
    }

    public ingestTelemetry(venueId: string, occupancyPercentage: number): void {
        let store = this.stores.get(venueId);
        if (!store) {
            store = new TimeSeriesStore(168);
            this.stores.set(venueId, store);
        }
        store.push(occupancyPercentage);
    }

    public ingestBatchTelemetry(venueId: string, data: number[]): void {
        let store = this.stores.get(venueId);
        if (!store) {
            store = new TimeSeriesStore(168);
            this.stores.set(venueId, store);
        }
        store.pushMultiple(data);
    }

    private startForecastLoop(): void {
        if (this.forecastInterval) return;

        // Recalculate forecasts every 15 minutes
        this.forecastInterval = setInterval(() => {
            this.generateAndEmitForecasts();
        }, 15 * 60 * 1000);
    }

    public generateAndEmitForecasts(): void {
        const results: Record<string, number[]> = {};
        const hw = new HoltWinters({ alpha: 0.3, beta: 0.1, gamma: 0.4, seasonLength: 24 });

        for (const [venueId, store] of this.stores.entries()) {
            const data = store.getData();
            if (data.length >= 48) { // Require at least 2 days of data for meaningful seasonality
                try {
                    // Check rolling variance using Welford's algorithm
                    const variance = store.getRollingVariance();
                    if (variance < 1e-6) {
                        const flatValue = Math.max(0, Math.min(100, Math.round(store.getMean() * 10) / 10));
                        results[venueId] = new Array(this.FORECAST_HORIZON).fill(flatValue);
                        continue;
                    }

                    const forecast = hw.fitAndForecast(data, this.FORECAST_HORIZON);
                    results[venueId] = forecast.predictions.map((p) =>
                        Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p * 10) / 10)) : 0
                    );
                } catch (error) {
                    console.error(`Forecast failed for venue ${venueId}:`, error);
                }
            }
        }

        if (Object.keys(results).length > 0 && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
            self.postMessage({
                type: 'FORECAST_UPDATE',
                payload: results
            });
        }
    }

    public getImmediateForecast(venueId: string): number[] | null {
        const store = this.stores.get(venueId);
        if (!store) return null;

        const data = store.getData();
        if (data.length < 48) return null;

        // Check rolling variance: flatline data produces constant projection
        const variance = store.getRollingVariance();
        if (variance < 1e-6) {
            const flatValue = Math.max(0, Math.min(100, Math.round(store.getMean() * 10) / 10));
            return new Array(this.FORECAST_HORIZON).fill(flatValue);
        }

        const hw = new HoltWinters({ alpha: 0.3, beta: 0.1, gamma: 0.4, seasonLength: 24 });
        try {
            const forecast = hw.fitAndForecast(data, this.FORECAST_HORIZON);
            return forecast.predictions.map((p) =>
                Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p * 10) / 10)) : 0
            );
        } catch {
            return null;
        }
    }

    public getRollingVariance(venueId: string, sample: boolean = false): number | null {
        const store = this.stores.get(venueId);
        return store ? store.getRollingVariance(sample) : null;
    }

    public getRollingStandardDeviation(venueId: string, sample: boolean = false): number | null {
        const store = this.stores.get(venueId);
        return store ? store.getRollingStandardDeviation(sample) : null;
    }

    public getStore(venueId: string): TimeSeriesStore | undefined {
        return this.stores.get(venueId);
    }
}

const engine = new PredictorEngine();

if (typeof self !== 'undefined') {
    self.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data;

        if (type === 'INIT') {
            engine.initialize(payload.venueIds);
            self.postMessage({ type: 'INITIALIZED' });
        } else if (type === 'INGEST_SINGLE') {
            engine.ingestTelemetry(payload.venueId, payload.occupancy);
        } else if (type === 'INGEST_BATCH') {
            engine.ingestBatchTelemetry(payload.venueId, payload.data);
        } else if (type === 'GET_FORECAST') {
            const forecast = engine.getImmediateForecast(payload.venueId);
            self.postMessage({
                type: 'FORECAST_RESPONSE',
                payload: { venueId: payload.venueId, forecast }
            });
        } else if (type === 'GET_VARIANCE') {
            const variance = engine.getRollingVariance(payload.venueId, payload?.sample ?? false);
            const stdDev = engine.getRollingStandardDeviation(payload.venueId, payload?.sample ?? false);
            self.postMessage({
                type: 'VARIANCE_RESPONSE',
                payload: { venueId: payload.venueId, variance, stdDev }
            });
        }
    };
}
