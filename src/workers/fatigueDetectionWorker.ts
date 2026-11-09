/**
 * Fatigue Detection Worker
 * Receives OffscreenCanvas frames, runs WASM inference, and emits health alerts.
 */

import { initTracker, processFrame, getLeftEar, getRightEar } from '@/lib/wasm-loader/eyeTracking';
import { initScorer, updateFatigueScore, getFatigueLevel, getPerclos } from '@/lib/wasm-loader/fatigueScorer';

let isWasmReady = false;
let lastAlertTime = 0;
const ALERT_COOLDOWN_MS = 60000; // 1 minute cooldown between alerts

self.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data;

    if (action === 'INIT') {
        try {
            await initTracker();
            await initScorer();
            isWasmReady = true;
            self.postMessage({ action: 'WASM_READY' });
        } catch (err: any) {
            self.postMessage({ action: 'WASM_ERROR', error: err.message });
        }
        return;
    }

    if (action === 'PROCESS_FRAME') {
        if (!isWasmReady) return;

        const { imageData, timestamp } = payload; // Uint8ClampedArray from OffscreenCanvas

        // Convert RGBA to Grayscale for C module
        const grayScale = new Uint8Array(imageData.length / 4);
        for (let i = 0, j = 0; i < imageData.length; i += 4, j++) {
            grayScale[j] = Math.round(
                0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2]
            );
        }

        const isFaceDetected = processFrame(grayScale, 320, 240);

        if (isFaceDetected) {
            const leftEar = getLeftEar();
            const rightEar = getRightEar();

            updateFatigueScore(leftEar, rightEar, timestamp);

            const fatigueLevel = getFatigueLevel();
            const perclos = getPerclos();

            if (fatigueLevel > 0 && (timestamp - lastAlertTime > ALERT_COOLDOWN_MS)) {
                self.postMessage({
                    action: 'FATIGUE_ALERT',
                    level: fatigueLevel,
                    perclos,
                    timestamp
                });
                lastAlertTime = timestamp;
            } else {
                self.postMessage({
                    action: 'METRICS_UPDATE',
                    level: fatigueLevel,
                    perclos,
                    timestamp
                });
            }
        }
    }
});

export { };
