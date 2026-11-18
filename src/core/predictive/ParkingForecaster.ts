/**
 * ParkingForecaster
 * Uses Holt-Winters exponential smoothing to predict hourly parking occupancy
 * based on historical trends, seasonality, and current gate telemetry.
 */

export interface TelemetryDataPoint {
    timestamp: number;
    occupancy: number;
    capacity: number;
    zoneId: string;
}

export interface ForecastResult {
    zoneId: string;
    timestamp: number;
    predictedOccupancy: number;
    confidence: number;
    availableSpots: number;
}

interface HoltWintersState {
    level: number;
    trend: number;
    seasonality: number[];
    alpha: number;
    beta: number;
    gamma: number;
    period: number;
}

export class ParkingForecaster {
    private historicalData: Map<string, TelemetryDataPoint[]>;
    private states: Map<string, HoltWintersState>;
    private readonly DEFAULT_PERIOD = 24; // Hourly seasonality

    constructor() {
        this.historicalData = new Map();
        this.states = new Map();
    }

    public ingestTelemetry(data: TelemetryDataPoint): void {
        const { zoneId } = data;
        if (!this.historicalData.has(zoneId)) {
            this.historicalData.set(zoneId, []);
            this.initializeState(zoneId, data.capacity);
        }

        const zoneData = this.historicalData.get(zoneId)!;
        zoneData.push(data);

        // Keep only last 7 days of hourly data to prevent memory bloat
        if (zoneData.length > this.DEFAULT_PERIOD * 7) {
            zoneData.shift();
        }

        this.updateState(zoneId, data.occupancy);
    }

    private initializeState(zoneId: string, capacity: number): void {
        this.states.set(zoneId, {
            level: capacity * 0.5, // Initial guess: 50% full
            trend: 0,
            seasonality: new Array(this.DEFAULT_PERIOD).fill(0),
            alpha: 0.3,
            beta: 0.1,
            gamma: 0.2,
            period: this.DEFAULT_PERIOD
        });
    }

    private updateState(zoneId: string, value: number): void {
        const state = this.states.get(zoneId);
        if (!state) return;

        const { alpha, beta, gamma, period } = state;
        const seasonIndex = new Date().getHours() % period;

        const prevLevel = state.level;
        const prevTrend = state.trend;
        const prevSeasonality = state.seasonality[seasonIndex];

        // Holt-Winters Additive Method
        state.level = alpha * (value - prevSeasonality) + (1 - alpha) * (prevLevel + prevTrend);
        state.trend = beta * (state.level - prevLevel) + (1 - beta) * prevTrend;
        state.seasonality[seasonIndex] = gamma * (value - state.level) + (1 - gamma) * prevSeasonality;

        this.states.set(zoneId, state);
    }

    public forecast(zoneId: string, hoursAhead: number): ForecastResult[] {
        const state = this.states.get(zoneId);
        const zoneData = this.historicalData.get(zoneId);

        if (!state || !zoneData || zoneData.length === 0) {
            return [];
        }

        const results: ForecastResult[] = [];
        const capacity = zoneData[zoneData.length - 1].capacity;
        const currentHour = new Date().getHours();

        for (let h = 1; h <= hoursAhead; h++) {
            const futureHour = (currentHour + h) % state.period;
            const seasonality = state.seasonality[futureHour];

            let predicted = state.level + (h * state.trend) + seasonality;

            // Clamp between 0 and capacity
            predicted = Math.max(0, Math.min(capacity, predicted));

            // Confidence decays as we look further ahead
            const confidence = Math.max(0.1, 1.0 - (h * 0.05));

            results.push({
                zoneId,
                timestamp: Date.now() + (h * 3600000),
                predictedOccupancy: Math.round(predicted),
                confidence,
                availableSpots: Math.round(capacity - predicted)
            });
        }

        return results;
    }

    public getOptimalZone(zones: string[]): string | null {
        let bestZone: string | null = null;
        let maxAvailability = -1;

        for (const zone of zones) {
            const forecast = this.forecast(zone, 1); // Look 1 hour ahead
            if (forecast.length > 0 && forecast[0].availableSpots > maxAvailability) {
                maxAvailability = forecast[0].availableSpots;
                bestZone = zone;
            }
        }

        return bestZone;
    }
}
