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

export interface CorrelatedEvent {
    id: string;
    name?: string;
    multiplier: number;
    correlatedEvents?: string[]; // Correlated event IDs
}

export class EventCorrelationMatrix {
    private weatherModifiers: Record<string, number>;
    private eventWeight: number;
    private trafficWeight: number;
    public readonly minMultiplier: number;
    public readonly maxMultiplier: number;

    constructor(minMultiplier: number = 0.5, maxMultiplier: number = 3.0) {
        this.weatherModifiers = {
            sunny: 1.0,
            rainy: 1.15,   // People seek indoor workspaces
            stormy: 1.25,
            snowy: 1.30
        };
        this.eventWeight = 0.2;
        this.trafficWeight = 0.1;
        this.minMultiplier = minMultiplier;
        this.maxMultiplier = maxMultiplier;
    }

    /**
     * Evaluates compound demand multiplier for correlated events using cycle detection
     * (visited set) to prevent recursive evaluation loops and Maximum call stack size exceeded errors.
     * Clamps the resulting multiplier to [minMultiplier, maxMultiplier].
     */
    public evaluateEventMultiplier(
        eventId: string,
        events: Record<string, CorrelatedEvent> | Map<string, CorrelatedEvent>,
        visited: Set<string> = new Set()
    ): number {
        if (visited.has(eventId)) {
            // Cycle detected: break loop
            return 1.0;
        }

        const event = events instanceof Map ? events.get(eventId) : events[eventId];
        if (!event) return 1.0;

        visited.add(eventId);

        let compound = event.multiplier ?? 1.0;

        if (Array.isArray(event.correlatedEvents)) {
            for (const neighborId of event.correlatedEvents) {
                if (!visited.has(neighborId)) {
                    const neighborMultiplier = this.evaluateEventMultiplier(neighborId, events, visited);
                    compound *= neighborMultiplier;
                }
            }
        }

        // Clamp cumulative multiplier to safe operational bounds
        return Math.max(this.minMultiplier, Math.min(this.maxMultiplier, compound));
    }

    /**
     * Computes the compound multiplier across all provided correlated events with cycle protection.
     */
    public calculateCompoundEventMultiplier(
        events: CorrelatedEvent[] | Record<string, CorrelatedEvent>
    ): number {
        const eventMap: Record<string, CorrelatedEvent> = Array.isArray(events)
            ? Object.fromEntries(events.map(e => [e.id, e]))
            : events;

        const visited = new Set<string>();
        let totalMultiplier = 1.0;

        for (const id of Object.keys(eventMap)) {
            if (!visited.has(id)) {
                totalMultiplier *= this.evaluateEventMultiplier(id, eventMap, visited);
            }
        }

        return Math.max(this.minMultiplier, Math.min(this.maxMultiplier, totalMultiplier));
    }

    public adjustDemandForecast(
        baseForecast: number[],
        factors: ExternalFactors,
        events?: CorrelatedEvent[] | Record<string, CorrelatedEvent>
    ): number[] {
        const weatherMod = this.weatherModifiers[factors.weatherCondition] || 1.0;
        const eventMod = 1.0 + (factors.localEventDensity * this.eventWeight);
        const trafficMod = 1.0 + (factors.trafficIndex * this.trafficWeight);

        let combinedMod = weatherMod * eventMod * trafficMod;

        if (events) {
            const eventMultiplier = this.calculateCompoundEventMultiplier(events);
            combinedMod *= eventMultiplier;
        }

        // Clamp combined multiplier within safe operational bounds
        const safeCombined = Math.max(this.minMultiplier, Math.min(4.0, combinedMod));

        return baseForecast.map(demand => demand * safeCombined);
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
