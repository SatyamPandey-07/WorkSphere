/**
 * Power Telemetry Worker
 * Streams IoT sensor data, passes it to the WASM anomaly detector,
 * and posts alerts back to the main thread.
 */

import { initPowerWasm, analyzePowerDraw, PowerAnalysisResult } from '@/lib/wasm-loader/power';

let isWasmReady = false;

self.addEventListener('message', async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await initPowerWasm();
            isWasmReady = true;
            self.postMessage({ type: 'INIT_SUCCESS' });
        } catch (err: any) {
            self.postMessage({ type: 'INIT_ERROR', error: err.message });
        }
        return;
    }

    if (type === 'TELEMETRY_STREAM') {
        if (!isWasmReady) {
            self.postMessage({ type: 'ERROR', error: 'WASM not ready for stream processing.' });
            return;
        }

        const { outletId, drawValue, timestamp } = payload;

        try {
            const result: PowerAnalysisResult = analyzePowerDraw(drawValue);

            if (result.status === 'SPIKE' || result.status === 'DROP') {
                self.postMessage({
                    type: 'ANOMALY_DETECTED',
                    payload: {
                        outletId,
                        timestamp,
                        ...result
                    }
                });
            } else {
                // Optional: Send periodic health checks even if normal
                if (Math.random() < 0.01) { // 1% sampling for normal logs to reduce noise
                    self.postMessage({
                        type: 'HEALTH_CHECK',
                        payload: { outletId, status: 'NORMAL', movingAverage: result.movingAverage }
                    });
                }
            }
        } catch (err: any) {
            self.postMessage({ type: 'PROCESSING_ERROR', outletId, error: err.message });
        }
    }

    if (type === 'RESET') {
        // Handle reset logic if needed
        self.postMessage({ type: 'RESET_COMPLETE' });
    }
});

// Handle worker termination
self.addEventListener('unload', () => {
    console.log('[PowerWorker] Terminating...');
});

export { };
