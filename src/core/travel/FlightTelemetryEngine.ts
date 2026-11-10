/**
 * FlightTelemetryEngine.ts
 * Polls aviation APIs and evaluates delay probabilities 
 * to trigger proactive itinerary adjustments.
 */

export interface FlightStatus {
    flightNumber: string;
    airline: string;
    departureAirport: string;
    arrivalAirport: string;
    scheduledDeparture: number; // Unix timestamp
    estimatedDeparture: number;
    scheduledArrival: number;
    estimatedArrival: number;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | 'DIVERTED';
    delayMinutes: number;
}

export interface TelemetryConfig {
    pollingIntervalMs: number;
    delayThresholdMinutes: number;
    cancellationThreshold: number;
}

export type FlightEventType = 'delay-detected' | 'cancellation-detected' | 'status-updated';

export class FlightTelemetryEngine {
    private config: TelemetryConfig;
    private activeFlights: Map<string, FlightStatus> = new Map();
    private pollingInterval: NodeJS.Timeout | null = null;
    private eventListeners: Map<FlightEventType, Set<(data: any) => void>> = new Map();

    constructor(config: TelemetryConfig) {
        this.config = config;
    }

    public on(event: FlightEventType, callback: (data: any) => void): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    private emit(event: FlightEventType, data: any): void {
        this.eventListeners.get(event)?.forEach(cb => cb(data));
    }

    public trackFlight(flight: FlightStatus): void {
        this.activeFlights.set(flight.flightNumber, flight);
    }

    public untrackFlight(flightNumber: string): void {
        this.activeFlights.delete(flightNumber);
    }

    public startPolling(): void {
        if (this.pollingInterval) return;

        this.pollingInterval = setInterval(async () => {
            await this.pollAllFlights();
        }, this.config.pollingIntervalMs);
    }

    public stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    private async pollAllFlights(): Promise<void> {
        for (const [flightNumber, currentStatus] of this.activeFlights.entries()) {
            try {
                const updatedStatus = await this.fetchFlightStatus(flightNumber);
                if (updatedStatus) {
                    this.evaluateAndEmit(flightNumber, currentStatus, updatedStatus);
                    this.activeFlights.set(flightNumber, updatedStatus);
                }
            } catch (error) {
                console.error(`[FlightTelemetry] Failed to poll ${flightNumber}:`, error);
            }
        }
    }

    private async fetchFlightStatus(flightNumber: string): Promise<FlightStatus | null> {
        // In production, this calls AviationStack, FlightAware, or OAG APIs
        // Mocking response for demonstration
        const mockDelay = Math.floor(Math.random() * 120); // 0 to 120 mins
        const isCancelled = Math.random() < 0.05; // 5% chance of cancellation

        const current = this.activeFlights.get(flightNumber);
        if (!current) return null;

        return {
            ...current,
            estimatedDeparture: current.scheduledDeparture + (mockDelay * 60000),
            estimatedArrival: current.scheduledArrival + (mockDelay * 60000),
            delayMinutes: mockDelay,
            status: isCancelled ? 'CANCELLED' : (mockDelay > 15 ? 'DELAYED' : 'ON_TIME')
        };
    }

    private evaluateAndEmit(flightNumber: string, oldStatus: FlightStatus, newStatus: FlightStatus): void {
        if (newStatus.status === 'CANCELLED' && oldStatus.status !== 'CANCELLED') {
            this.emit('cancellation-detected', { flightNumber, status: newStatus });
            return;
        }

        if (newStatus.delayMinutes >= this.config.delayThresholdMinutes &&
            oldStatus.delayMinutes < this.config.delayThresholdMinutes) {
            this.emit('delay-detected', { flightNumber, status: newStatus, delayMinutes: newStatus.delayMinutes });
            return;
        }

        if (newStatus.estimatedArrival !== oldStatus.estimatedArrival) {
            this.emit('status-updated', { flightNumber, status: newStatus });
        }
    }

    public getTrackedFlights(): FlightStatus[] {
        return Array.from(this.activeFlights.values());
    }
}