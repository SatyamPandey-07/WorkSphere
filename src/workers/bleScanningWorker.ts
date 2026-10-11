/**
 * bleScanningWorker.ts
 * Web Worker script that interfaces with the Web Bluetooth API to continuously scan and filter beacon payloads.
 * Offloads the heavy Kalman filtering logic to prevent main thread jank.
 */

import { bleProximityWasm } from '@/lib/wasm-loader/ble-proximity';

interface BeaconReading {
  id: string;
  rssi: number;
  timestamp: number;
}

let kalmanStates: Map<string, any> = new Map();

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'INIT') {
    try {
      await bleProximityWasm.initialize(payload.wasmUrl);
      self.postMessage({ type: 'READY', success: true });
    } catch (error) {
      self.postMessage({ type: 'READY', success: false, error: String(error) });
    }
  }

  if (type === 'PROCESS_BEACONS') {
    try {
      const readings: BeaconReading[] = payload.readings;
      const instance = await bleProximityWasm.getInstance();
      const results: any[] = [];

      for (const reading of readings) {
        // Convert RSSI to approximate distance (simplified log-distance path loss)
        const estimatedDistance = Math.pow(10, ( -59 - reading.rssi ) / ( 10 * 2.0 ));
        
        // Mock 2D coordinates based on distance and beacon ID hash
        const mockX = estimatedDistance * Math.cos(reading.id.length);
        const mockY = estimatedDistance * Math.sin(reading.id.length);

        if (!kalmanStates.has(reading.id)) {
          // Initialize Kalman state for new beacon
          const statePtr = 0; // Simplified memory management for scaffold
          (instance.exports.kalman_init as CallableFunction)(statePtr, mockX, mockY, 2.0, 0.1);
          kalmanStates.set(reading.id, { ptr: statePtr, x: mockX, y: mockY });
        }

        const state = kalmanStates.get(reading.id);
        
        // Update Kalman filter
        (instance.exports.kalman_update as CallableFunction)(state.ptr, mockX, mockY);
        
        const smoothedX = (instance.exports.kalman_get_x as CallableFunction)(state.ptr);
        const smoothedY = (instance.exports.kalman_get_y as CallableFunction)(state.ptr);

        results.push({
          beaconId: reading.id,
          smoothedX,
          smoothedY,
          confidence: 1.0 / (1.0 + estimatedDistance) // Higher confidence for closer beacons
        });
      }

      self.postMessage({
        type: 'FILTERED_BEACONS',
        payload: results
      });
    } catch (error) {
      self.postMessage({ type: 'ERROR', error: String(error) });
    }
  }
};
