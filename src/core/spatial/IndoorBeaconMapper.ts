/**
 * IndoorBeaconMapper.ts
 * Translates smoothed BLE signal strengths into 2D indoor coordinates based on the venue's beacon topology.
 * Uses trilateration to pinpoint the user's desk location.
 */

export interface BeaconTopology {
    beaconId: string;
    fixedX: number;
    fixedY: number;
    fixedZ?: number;
    floor?: number;
}

export interface UserLocation {
    x: number;
    y: number;
    z: number;
    floor?: number;
    accuracyMeters: number;
    timestamp: number;
}

export interface IndoorBeaconMapperOptions {
    floorHeightMeters?: number; // Default floor-to-floor height (e.g. 3.5m)
}

export class IndoorBeaconMapper {
    private topology: Map<string, BeaconTopology>;
    private floorHeightMeters: number;

    constructor(topology: BeaconTopology[], options?: IndoorBeaconMapperOptions) {
        this.topology = new Map();
        this.floorHeightMeters = options?.floorHeightMeters ?? 3.5;
        for (const beacon of topology) {
            this.topology.set(beacon.beaconId, beacon);
        }
    }

    /**
     * Resolves beacon altitude (z) with fallback:
     * 1. Explicit beacon.fixedZ
     * 2. If floor is specified, floor * floorHeightMeters
     * 3. Fallback to 0.0 (ground level of the current floor)
     */
    public getBeaconAltitude(beacon: BeaconTopology): number {
        if (typeof beacon.fixedZ === 'number' && Number.isFinite(beacon.fixedZ)) {
            return beacon.fixedZ;
        }
        if (typeof beacon.floor === 'number' && Number.isFinite(beacon.floor)) {
            return beacon.floor * this.floorHeightMeters;
        }
        return 0.0;
    }

    /**
     * Calculates 3D distance between a point and a beacon, safely defaulting altitude to 0.0.
     */
    public calculateDistance(
        point: { x: number; y: number; z?: number },
        beacon: BeaconTopology
    ): number {
        const pz = point.z ?? 0.0;
        const bz = this.getBeaconAltitude(beacon);
        const dx = point.x - beacon.fixedX;
        const dy = point.y - beacon.fixedY;
        const dz = pz - bz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Calculates user location using weighted centroid trilateration in 3D,
     * defaulting missing altitude z to 0.0 without producing NaN coordinates.
     */
    public calculateLocation(
        filteredBeacons: {
            beaconId: string;
            smoothedX?: number;
            smoothedY?: number;
            smoothedZ?: number;
            confidence: number;
        }[]
    ): UserLocation | null {
        if (filteredBeacons.length === 0) return null;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let totalWeight = 0;
        let dominantFloor: number | undefined;

        for (const beacon of filteredBeacons) {
            const topology = this.topology.get(beacon.beaconId);
            if (!topology) continue;

            const weight = beacon.confidence;
            if (!Number.isFinite(weight) || weight <= 0) continue;

            const beaconZ = this.getBeaconAltitude(topology);

            sumX += topology.fixedX * weight;
            sumY += topology.fixedY * weight;
            sumZ += beaconZ * weight;
            totalWeight += weight;

            if (topology.floor !== undefined && dominantFloor === undefined) {
                dominantFloor = topology.floor;
            }
        }

        if (totalWeight === 0) return null;

        const calculatedZ = sumZ / totalWeight;
        const finalZ = Number.isFinite(calculatedZ) ? calculatedZ : 0.0;

        return {
            x: sumX / totalWeight,
            y: sumY / totalWeight,
            z: finalZ,
            floor: dominantFloor,
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
