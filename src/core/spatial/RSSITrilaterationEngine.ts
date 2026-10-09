/**
 * RSSITrilaterationEngine.ts
 * Solves the system of non-linear equations to estimate 2D/3D coordinates from multiple WiFi access point signal strengths.
 * Uses the Log-Distance Path Loss Model to convert RSSI to distance, then applies multilateration.
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

    public rssiToDistance(rssi: number, txPower: number, n: number): number {
        if (rssi >= txPower) return 1.0;
        const ratio = (txPower - rsi) / (10 * n);
        return Math.pow(10, ratio);
    }

    public calculatePosition(aps: AccessPoint[]): PositionEstimate | null {
        if (aps.length < 3) {
            return null; // Trilateration requires at least 3 points for 2D, 4 for 3D
        }

        const distances = aps.map(ap => this.rssiToDistance(ap.rssi, ap.txPower, ap.n));

        let sumX = 0, sumY = 0, sumZ = 0, sumW = 0;
        let totalWeight = 0;

        for (let i = 0; i < aps.length; i++) {
            const weight = 1 / (distances[i] * distances[i]);
            sumX += aps[i].x * weight;
            sumY += aps[i].y * weight;
            sumZ += aps[i].z * weight;
            totalWeight += weight;
        }

        const estimatedX = sumX / totalWeight;
        const estimatedY = sumY / totalWeight;
        const estimatedZ = sumZ / totalWeight;

        let errorSum = 0;
        for (let i = 0; i < aps.length; i++) {
            const dx = estimatedX - aps[i].x;
            const dy = estimatedY - aps[i].y;
            const dz = estimatedZ - aps[i].z;
            const calculatedDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            errorSum += Math.abs(calculatedDist - distances[i]);
        }

        const accuracy = errorSum / aps.length;

        return {
            x: estimatedX,
            y: estimatedY,
            z: estimatedZ,
            accuracy,
            apsUsed: aps.length
        };
    }
}
