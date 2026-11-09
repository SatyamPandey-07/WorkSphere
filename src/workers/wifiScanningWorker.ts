/**
 * wifiScanningWorker.ts
 * Web Worker that interfaces with experimental browser network APIs or fallback Bluetooth beacons to gather RSSI data.
 * Processes raw sensor data and applies trilateration and Kalman filtering off the main thread.
 */

import { RSSITrilaterationEngine, AccessPoint, PositionEstimate } from '@/core/spatial/RSSITrilaterationEngine';
import { KalmanFilterSmoother } from '@/core/spatial/KalmanFilterSmoother';

let trilaterationEngine: RSSITrilaterationEngine | null = null;
let kalmanFilter: KalmanFilterSmoother | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        trilaterationEngine = new RSSITrilaterationEngine();
        kalmanFilter = new KalmanFilterSmoother(0, 0, payload.processNoise, payload.measurementNoise, payload.dt);
        self.postMessage({ type: 'INITIALIZED', success: true });
    }

    if (type === 'PROCESS_SCAN' && trilaterationEngine && kalmanFilter) {
        const { accessPoints } = payload as { accessPoints: AccessPoint[] };

        const rawPosition = trilaterationEngine.calculatePosition(accessPoints);

        if (rawPosition) {
            kalmanFilter.predict();
            const smoothedState = kalmanFilter.update(rawPosition.x, rawPosition.y);

            self.postMessage({
                type: 'POSITION_UPDATE',
                payload: {
                    x: smoothedState.x,
                    y: smoothedState.y,
                    z: rawPosition.z,
                    accuracy: rawPosition.accuracy,
                    apsUsed: rawPosition.apsUsed,
                    rawX: rawPosition.x,
                    rawY: rawPosition.y
                }
            });
        } else {
            self.postMessage({ type: 'POSITION_UPDATE', error: 'Insufficient access points for trilateration' });
        }
    }
};
