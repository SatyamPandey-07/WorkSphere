/**
 * IndoorBeaconMapper.ts
 * Translates smoothed BLE signal strengths into 2D indoor coordinates based on the venue's beacon topology.
 * Uses trilateration to pinpoint the user's desk location.
 */

export interface BeaconTopology {
    beaconId: string;
    fixedX: number;
    fixedY: number;
}

export interface UserLocation {
    x: number;
    y: number;
    accuracyMeters: number;
    timestamp: number;
}

export class IndoorBeaconMapper {
    private topology: Map<string, BeaconTopology>;

    constructor(topology: BeaconTopology[]) {
        this.topology = new Map();
        for (const beacon of topology) {
            this.topology.set(beacon.beaconId, beacon);
        }
    }

    /**
     * Calculates user location using weighted centroid trilateration.
     */
    public calculateLocation(filteredBeacons: { beaconId: string; smoothedX: number; smoothedY: number; confidence: number }[]): UserLocation | null {
        if (filteredBeacons.length === 0) return null;

        let sumX = 0;
        let sumY = 0;
        let totalWeight = 0;

        for (const beacon of filteredBeacons) {
            const topology = this.topology.get(beacon.beaconId);
            if (!topology) continue;

            // Weight by confidence (derived from signal strength/Kalman certainty)
            const weight = beacon.confidence;
            sumX += topology.fixedX * weight;
            sumY += topology.fixedY * weight;
            totalWeight += weight;
        }

        if (totalWeight === 0) return null;

        return {
            x: sumX / totalWeight,
            y: sumY / totalWeight,
            accuracyMeters: 5.0 / totalWeight, // Simplified accuracy metric
            timestamp: Date.now()
        };
    }

    public updateTopology(newTopology: BeaconTopology[]): void {
        this.topology.clear();
        for (const beacon of newTopology) {
            this.topology.set(beacon.beaconId, beacon);
        }
    }
}
