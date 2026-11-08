/**
 * TrilaterationEngine.ts
 * Computes 2D non-linear least-squares trilateration across 3 or more detected BLE beacon RSSI readings
 * to calculate continuous (X, Y) floorplan coordinates with exponential distance smoothing.
 */

export interface BeaconReading {
    id: string;
    rssi: number;
    x: number;
    y: number;
}

export interface Position {
    x: number;
    y: number;
    accuracy: number;
}

export class TrilaterationEngine {
    private referenceTxPower: number;
    private pathLossExponent: number;
    private smoothingFactor: number;
    private lastPosition: Position | null;

    constructor(referenceTxPower: number = -59, pathLossExponent: number = 2.0, smoothingFactor: number = 0.3) {
        this.referenceTxPower = referenceTxPower;
        this.pathLossExponent = pathLossExponent;
        this.smoothingFactor = smoothingFactor;
        this.lastPosition = null;
    }

    /**
     * Converts RSSI to estimated distance using the log-distance path loss formula.
     */
    private rssiToDistance(rssi: number): number {
        const ratio = (this.referenceTxPower - rssi) / (10 * this.pathLossExponent);
        return Math.pow(10, ratio);
    }

    /**
     * Computes user (X, Y) floorplan position via 3-beacon trilateration algorithm.
     * Uses linear least-squares approximation for non-linear system.
     */
    public calculatePosition(readings: BeaconReading[]): Position | null {
        if (readings.length < 3) {
            return null; // Need at least 3 beacons for 2D trilateration
        }

        // Sort by strongest signal (lowest RSSI) to use the closest as reference
        const sorted = [...readings].sort((a, b) => a.rssi - b.rssi);
        const refBeacon = sorted[0];
        const refDistance = this.rssiToDistance(refBeacon.rssi);

        // Build linear system Ax = b
        const A: number[][] = [];
        const b: number[] = [];

        for (let i = 1; i < sorted.length; i++) {
            const beacon = sorted[i];
            const distance = this.rssiToDistance(beacon.rssi);

            const row = [
                2 * (beacon.x - refBeacon.x),
                2 * (beacon.y - refBeacon.y)
            ];
            A.push(row);

            const value =
                Math.pow(refBeacon.x, 2) - Math.pow(beacon.x, 2) +
                Math.pow(refBeacon.y, 2) - Math.pow(beacon.y, 2) +
                Math.pow(distance, 2) - Math.pow(refDistance, 2);

            b.push(value);
        }

        // Solve using pseudo-inverse (simplified for 2D)
        const position = this.solveLinearSystem(A, b);

        if (!position) return null;

        // Apply exponential smoothing to prevent location jumping
        let smoothedPosition = position;
        if (this.lastPosition) {
            smoothedPosition = {
                x: this.lastPosition.x + this.smoothingFactor * (position.x - this.lastPosition.x),
                y: this.lastPosition.y + this.smoothingFactor * (position.y - this.lastPosition.y),
                accuracy: position.accuracy,
            };
        }

        this.lastPosition = smoothedPosition;
        return smoothedPosition;
    }

    private solveLinearSystem(A: number[][], b: number[]): Position | null {
        // Simplified least squares solver for 2D
        // In production, use a robust math library like math.js
        if (A.length < 2) return null;

        // For exactly 2 equations (3 beacons), we can solve directly
        const a11 = A[0][0], a12 = A[0][1], b1 = b[0];
        const a21 = A[1][0], a22 = A[1][1], b2 = b[1];

        const determinant = a11 * a22 - a12 * a21;
        if (Math.abs(determinant) < 1e-6) return null; // Singular matrix

        const x = (b1 * a22 - b2 * a12) / determinant;
        const y = (a11 * b2 - a21 * b1) / determinant;

        // Calculate accuracy based on residual error
        const residual = Math.abs(a11 * x + a12 * y - b1) + Math.abs(a21 * x + a22 * y - b2);
        const accuracy = Math.max(0.5, residual / 2);

        return { x, y, accuracy };
    }

    public reset(): void {
        this.lastPosition = null;
    }
}
