/**
 * Applies a Kalman filter to raw BLE RSSI data to calculate smooth, 
 * accurate physical distance between team members.
 */

export class KalmanFilter {
    private q: number; // Process noise covariance
    private r: number; // Measurement noise covariance
    private x: number; // Estimated value
    private p: number; // Estimation error covariance
    private k: number; // Kalman gain

    constructor(processNoise: number, measurementNoise: number, initialValue: number) {
        this.q = processNoise;
        this.r = measurementNoise;
        this.x = initialValue;
        this.p = 1.0;
        this.k = 0.0;
    }

    public update(measurement: number): number {
        // Prediction update
        this.p = this.p + this.q;

        // Measurement update
        this.k = this.p / (this.p + this.r);
        this.x = this.x + this.k * (measurement - this.x);
        this.p = (1 - this.k) * this.p;

        return this.x;
    }

    public getEstimate(): number {
        return this.x;
    }
}

export interface BeaconReading {
    macAddress: string;
    rssi: number;
    timestamp: number;
}

export class BLEProximityFusion {
    private filters: Map<string, KalmanFilter> = new Map();
    private txPower: number; // RSSI at 1 meter distance

    constructor(txPower: number = -59) {
        this.txPower = txPower;
    }

    /**
     * Processes a raw RSSI reading and returns the smoothed distance in meters.
     * Uses the Log-Distance Path Loss Model.
     */
    public processReading(reading: BeaconReading): number {
        let filter = this.filters.get(reading.macAddress);

        if (!filter) {
            // Initialize filter with the first reading
            // High process noise, moderate measurement noise for BLE environments
            filter = new KalmanFilter(0.1, 3.0, reading.rssi);
            this.filters.set(reading.macAddress, filter);
        }

        const smoothedRssi = filter.update(reading.rssi);
        return this.rssiToDistance(smoothedRssi);
    }

    /**
     * Converts RSSI to distance using the Log-Distance Path Loss Model.
     * Distance = 10 ^ ((TxPower - RSSI) / (10 * n))
     * n = path loss exponent (typically 2.0 for free space, 2.5-3.0 for indoor)
     */
    private rssiToDistance(rssi: number, pathLossExponent: number = 2.5): number {
        if (rssi === 0) return -1.0; // Invalid reading

        const ratio = (this.txPower - rssi) / (10 * pathLossExponent);
        const distance = Math.pow(10, ratio);

        // Clamp distance to reasonable indoor bounds
        return Math.max(0.1, Math.min(distance, 50.0));
    }

    /**
     * Prunes stale filters for beacons that haven't been seen recently.
     */
    public pruneStaleFilters(maxAgeMs: number = 10000): void {
        const now = Date.now();
        // In a real implementation, we would track the last update time per filter
        // For this engine, we just clear the map if explicitly called
        this.filters.clear();
    }
}
