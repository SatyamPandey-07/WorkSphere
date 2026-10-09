/**
 * EventCorrelationMatrix.ts
 * Ingests external API data (weather, local events) and adjusts baseline demand expectations.
 * Maps external factors to demand multipliers to refine the forecasting model.
 */

export interface ExternalFactors {
    weatherCondition: 'sunny' | 'rainy' | 'stormy' | 'snowy';
    temperatureCelsius: number;
    localEventDensity: number; // 0.0 to 1.0
    trafficIndex: number; // 0.0 to 1.0
}

export class EventCorrelationMatrix {
    private weatherModifiers: Record<string, number>;
    private eventWeight: number;
    private trafficWeight: number;

    constructor() {
        this.weatherModifiers = {
            sunny: 1.0,
            rainy: 1.15,   // People seek indoor workspaces
            stormy: 1.25,
            snowy: 1.30
        };
        this.eventWeight = 0.2;
        this.trafficWeight = 0.1;
    }

    public adjustDemandForecast(baseForecast: number[], factors: ExternalFactors): number[] {
        const weatherMod = this.weatherModifiers[factors.weatherCondition] || 1.0;
        const eventMod = 1.0 + (factors.localEventDensity * this.eventWeight);
        const trafficMod = 1.0 + (factors.trafficIndex * this.trafficWeight);

        const combinedMod = weatherMod * eventMod * trafficMod;

        return baseForecast.map(demand => demand * combinedMod);
    }

    public async fetchExternalFactors(lat: number, lng: number, date: Date): Promise<ExternalFactors> {
        // Mock external API calls for scaffold
        return {
            weatherCondition: 'rainy',
            temperatureCelsius: 18,
            localEventDensity: 0.4,
            trafficIndex: 0.6
        };
    }
}
