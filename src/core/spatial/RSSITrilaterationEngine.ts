/**
 * RSSITrilaterationEngine.ts
 * Solves the system of non-linear equations to estimate 2D/3D coordinates from multiple WiFi access point signal strengths.
 * Uses the Log-Distance Path Loss Model to convert RSSI to distance with strictly positive clamping, then applies multilateration.
 */

export interface AccessPoint {
    id: string;
    x: number;
    y: number;
    z: number;
    rssi: number;
    txPower: number; // Signal strength at 1 meter
    n: number; // Path loss exponent (typically 2.0 to 4.0 indoors)
}

export interface PositionEstimate {
    x: number;
    y: number;
    z: number;
    accuracy: number;
    apsUsed: number;
}

export class RSSITrilaterationEngine {
    private readonly SPEED_OF_LIGHT = 299792458; // m/s (not directly used in RSSI, but good for hybrid models)
    private readonly MIN_DISTANCE = 0.01; // Minimum distance clamp in meters (1 cm)
    private readonly MAX_DISTANCE = 500.0; // Maximum distance clamp in meters

    /**
     * Converts raw RSSI to an estimated metric distance using the Log-Distance Path Loss Model.
     * Clamps output to strictly positive, finite distance values.
     * 
     * Formula: d = 10 ^ ((txPower - rssi) / (10 * n))
     */
    public rssiToDistance(
        rssi: number,
        txPower: number,
        n: number,
        minDistance: number = this.MIN_DISTANCE,
        maxDistance: number = this.MAX_DISTANCE
    ): number {
        const pathLossExponent = Math.max(1.0, Number.isFinite(n) && n > 0 ? n : 2.0);
        const minClamp = Math.max(1e-4, Number.isFinite(minDistance) && minDistance > 0 ? minDistance : this.MIN_DISTANCE);
        const maxClamp = Math.max(minClamp, Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : this.MAX_DISTANCE);

        if (!Number.isFinite(rssi) || !Number.isFinite(txPower)) {
            return minClamp;
        }

        const ratio = (txPower - rssi) / (10 * pathLossExponent);
        const rawDistance = Math.pow(10, ratio);

        if (!Number.isFinite(rawDistance) || rawDistance <= 0) {
            return minClamp;
        }

        return Math.max(minClamp, Math.min(maxClamp, rawDistance));
    }

    public calculatePosition(aps: AccessPoint[]): PositionEstimate | null {
        if (!aps || aps.length < 3) {
            return null; // Trilateration requires at least 3 points for 2D, 4 for 3D
        }

        // Filter valid access points with finite coordinates and signal values
        const validAps = aps.filter(ap =>
            Number.isFinite(ap.x) &&
            Number.isFinite(ap.y) &&
            Number.isFinite(ap.z) &&
            Number.isFinite(ap.rssi) &&
            Number.isFinite(ap.txPower)
        );

        if (validAps.length < 3) {
            return null;
        }

        const distances = validAps.map(ap => this.rssiToDistance(ap.rssi, ap.txPower, ap.n));

        let sumX = 0, sumY = 0, sumZ = 0;
        let totalWeight = 0;

        for (let i = 0; i < validAps.length; i++) {
            const dist = Math.max(this.MIN_DISTANCE, distances[i]);
            const weight = 1 / (dist * dist);
            sumX += validAps[i].x * weight;
            sumY += validAps[i].y * weight;
            sumZ += validAps[i].z * weight;
            totalWeight += weight;
        }

        if (totalWeight <= 0 || !Number.isFinite(totalWeight)) {
            return null;
        }

        const estimatedX = sumX / totalWeight;
        const estimatedY = sumY / totalWeight;
        const estimatedZ = sumZ / totalWeight;

        let errorSum = 0;
        for (let i = 0; i < validAps.length; i++) {
            const dx = estimatedX - validAps[i].x;
            const dy = estimatedY - validAps[i].y;
            const dz = estimatedZ - validAps[i].z;
            const calculatedDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            errorSum += Math.abs(calculatedDist - distances[i]);
        }

        const accuracy = errorSum / validAps.length;

        return {
            x: estimatedX,
            y: estimatedY,
            z: estimatedZ,
            accuracy,
            apsUsed: validAps.length
        };
    }
}
