/**
 * EVChargerLoadBalancer
 * Distributes incoming EV charging requests across available stations 
 * to prevent local grid overloads and optimize charging speeds.
 */

export enum ChargerStatus {
    AVAILABLE = 'AVAILABLE',
    OCCUPIED = 'OCCUPIED',
    MAINTENANCE = 'MAINTENANCE',
    OFFLINE = 'OFFLINE'
}

export interface EVChargerStation {
    stationId: string;
    zoneId: string;
    maxKw: number;
    currentLoadKw: number;
    status: ChargerStatus;
    connectorType: 'CCS' | 'CHAdeMO' | 'Type2';
    queueDepth: number;
}

export interface ChargingRequest {
    requestId: string;
    vehicleType: string;
    requiredKw: number;
    connectorType: 'CCS' | 'CHAdeMO' | 'Type2';
    priority: 'STANDARD' | 'HIGH';
}

export interface RoutingDecision {
    requestId: string;
    assignedStationId: string;
    estimatedWaitMinutes: number;
    reasoning: string;
}

export class EVChargerLoadBalancer {
    private stations: Map<string, EVChargerStation>;
    private gridLimits: Map<string, number>; // zoneId -> max total kW

    constructor(stations: EVChargerStation[], gridLimits: Record<string, number>) {
        this.stations = new Map(stations.map(s => [s.stationId, { ...s }]));
        this.gridLimits = new Map(Object.entries(gridLimits));
    }

    public updateStationStatus(stationId: string, updates: Partial<EVChargerStation>): void {
        const station = this.stations.get(stationId);
        if (station) {
            this.stations.set(stationId, { ...station, ...updates });
        }
    }

    private getZoneLoad(zoneId: string): number {
        let totalLoad = 0;
        for (const station of this.stations.values()) {
            if (station.zoneId === zoneId) {
                totalLoad += station.currentLoadKw;
            }
        }
        return totalLoad;
    }

    public evaluateRouting(request: ChargingRequest): RoutingDecision | null {
        const compatibleStations = Array.from(this.stations.values()).filter(
            s => s.status === ChargerStatus.AVAILABLE && s.connectorType === request.connectorType
        );

        if (compatibleStations.length === 0) {
            // Find stations in maintenance or occupied to estimate wait
            const queuedStations = Array.from(this.stations.values()).filter(
                s => s.connectorType === request.connectorType && s.status === ChargerStatus.OCCUPIED
            );

            if (queuedStations.length === 0) return null;

            const minQueue = Math.min(...queuedStations.map(s => s.queueDepth));
            return {
                requestId: request.requestId,
                assignedStationId: 'WAITLIST',
                estimatedWaitMinutes: minQueue * 20, // Assume 20 mins per charge
                reasoning: 'No compatible chargers available. Added to waitlist.'
            };
        }

        let bestStation: EVChargerStation | null = null;
        let bestScore = -Infinity;

        for (const station of compatibleStations) {
            const zoneLimit = this.gridLimits.get(station.zoneId) || Infinity;
            const currentZoneLoad = this.getZoneLoad(station.zoneId);

            // Prevent grid overload
            if (currentZoneLoad + request.requiredKw > zoneLimit * 0.95) {
                continue; // Skip this station, zone is near capacity
            }

            // Score based on available capacity and queue depth
            const availableCapacity = station.maxKw - station.currentLoadKw;
            const capacityScore = availableCapacity / station.maxKw;
            const queuePenalty = station.queueDepth * 0.2;

            const score = capacityScore - queuePenalty;

            if (score > bestScore) {
                bestScore = score;
                bestStation = station;
            }
        }

        if (!bestStation) {
            return {
                requestId: request.requestId,
                assignedStationId: 'WAITLIST',
                estimatedWaitMinutes: 15,
                reasoning: 'Grid limits prevent immediate charging. Please wait.'
            };
        }

        return {
            requestId: request.requestId,
            assignedStationId: bestStation.stationId,
            estimatedWaitMinutes: bestStation.queueDepth * 5,
            reasoning: `Routed to ${bestStation.stationId} (Load: ${bestStation.currentLoadKw}kW, Zone: ${bestStation.zoneId})`
        };
    }

    public assignRequest(request: ChargingRequest): RoutingDecision | null {
        const decision = this.evaluateRouting(request);
        if (decision && decision.assignedStationId !== 'WAITLIST') {
            const station = this.stations.get(decision.assignedStationId);
            if (station) {
                station.status = ChargerStatus.OCCUPIED;
                station.currentLoadKw += request.requiredKw;
                this.stations.set(station.stationId, station);
            }
        }
        return decision;
    }
}
