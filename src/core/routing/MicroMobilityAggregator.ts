/**
 * MicroMobilityAggregator.ts
 * Fetches and normalizes real-time availability and pricing from various scooter/bike APIs.
 * Acts as an adapter layer to unify disparate micro-mobility provider data formats.
 */

export interface MicroMobilityVehicle {
    id: string;
    provider: string;
    type: 'scooter' | 'bike' | 'ebike';
    latitude: number;
    longitude: number;
    batteryLevel: number;
    pricePerMinute: number;
    isAvailable: boolean;
}

export class MicroMobilityAggregator {
    private providers: string[];
    private apiKey: string;

    constructor(providers: string[] = ['lime', 'bird', 'spin'], apiKey: string = '') {
        this.providers = providers;
        this.apiKey = apiKey;
    }

    public async fetchVehiclesInRadius(
        lat: number,
        lng: number,
        radiusMeters: number
    ): Promise<MicroMobilityVehicle[]> {
        const allVehicles: MicroMobilityVehicle[] = [];

        for (const provider of this.providers) {
            try {
                // Mock API call to provider
                const vehicles = await this.mockProviderApi(provider, lat, lng, radiusMeters);
                allVehicles.push(...vehicles);
            } catch (error) {
                console.warn(`Failed to fetch from provider ${provider}:`, error);
            }
        }

        return allVehicles.sort((a, b) => a.pricePerMinute - b.pricePerMinute);
    }

    private async mockProviderApi(
        provider: string,
        lat: number,
        lng: number,
        radiusMeters: number
    ): Promise<MicroMobilityVehicle[]> {
        // Simulate network delay and return mock data
        await new Promise((resolve) => setTimeout(resolve, 100));

        return [
            {
                id: `${provider}-123`,
                provider,
                type: 'scooter',
                latitude: lat + 0.001,
                longitude: lng + 0.001,
                batteryLevel: 85,
                pricePerMinute: 0.35,
                isAvailable: true,
            },
            {
                id: `${provider}-456`,
                provider,
                type: 'ebike',
                latitude: lat - 0.002,
                longitude: lng + 0.003,
                batteryLevel: 60,
                pricePerMinute: 0.45,
                isAvailable: true,
            }
        ];
    }

    public calculateEstimatedCost(vehicle: MicroMobilityVehicle, durationMinutes: number): number {
        if (!vehicle.isAvailable) return Infinity;
        return vehicle.pricePerMinute * durationMinutes;
    }
}
