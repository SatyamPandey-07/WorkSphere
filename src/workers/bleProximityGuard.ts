/**
 * BLE Proximity Guard Worker
 * Continuously monitors BLE RSSI values, applying a Kalman filter to smooth distance calculations 
 * and prevent false disconnects.
 */

interface BLEMessage {
    type: 'UPDATE_RSSI';
    payload: { rssi: number; txPower: number };
}

interface GuardAlert {
    type: 'PROXIMITY_ALERT';
    payload: { breached: boolean; estimatedDistance: number };
}

// Kalman Filter State
let kalmanState = {
    x: 0, // Estimated distance
    P: 1, // Error covariance
    Q: 0.1, // Process noise
    R: 2.0  // Measurement noise (RSSI is very noisy)
};

const BREACH_THRESHOLD_METERS = 5.0;
const HYSTERESIS_METERS = 1.5; // Prevent flapping at the boundary

self.onmessage = (event: MessageEvent<BLEMessage>) => {
    if (event.data.type === 'UPDATE_RSSI') {
        const { rssi, txPower } = event.data.payload;

        // 1. Convert RSSI to raw distance estimate (Log-Distance Path Loss Model)
        const rawDistance = rssiToDistance(rssi, txPower);

        // 2. Apply Kalman Filter to smooth the estimate
        const smoothedDistance = applyKalmanFilter(rawDistance);

        // 3. Evaluate breach condition
        // Note: In a real app, we'd track the previous state to implement hysteresis properly
        const breached = smoothedDistance > BREACH_THRESHOLD_METERS;

        const alert: GuardAlert = {
            type: 'PROXIMITY_ALERT',
            payload: {
                breached,
                estimatedDistance: smoothedDistance
            }
        };

        self.postMessage(alert);
    }
};

function rssiToDistance(rssi: number, txPower: number): number {
    // Simplified Free Space Path Loss (FSPL) approximation
    // Distance = 10 ^ ((TxPower - RSSI) / (10 * n))
    // n = path loss exponent (typically 2.0 for free space, 2.7-3.5 for indoor office)
    const n = 2.8;
    const ratio = (txPower - rssi) / (10 * n);
    return Math.pow(10, ratio);
}

function applyKalmanFilter(measurement: number): number {
    // Prediction step
    // Assuming constant velocity model, but for distance from a stationary anchor, x_pred = x
    const x_pred = kalmanState.x;
    const P_pred = kalmanState.P + kalmanState.Q;

    // Update step
    const K = P_pred / (P_pred + kalmanState.R); // Kalman Gain
    kalmanState.x = x_pred + K * (measurement - x_pred);
    kalmanState.P = (1 - K) * P_pred;

    return kalmanState.x;
}

export { };
