/**
 * queuePredictionWorker.ts
 * Web Worker that processes low-framerate camera streams locally to detect queue formation and length.
 * Offloads computer vision tasks to ensure the main thread remains responsive for UI interactions.
 */

import { crowdWasm } from '@/lib/wasm-loader/crowd';

interface QueueAnalysisResult {
    estimatedCount: number;
    confidence: number;
    isQueueForming: boolean;
    timestamp: number;
}

let previousFrame: Uint8Array | null = null;

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await crowdWasm.initialize(payload.wasmUrl);
            self.postMessage({ type: 'READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'READY', success: false, error: String(error) });
        }
    }

    if (type === 'ANALYZE_FRAME') {
        try {
            const { frameData, width, height, zoneId } = payload;

            if (!previousFrame || previousFrame.length !== frameData.length) {
                previousFrame = new Uint8Array(frameData);
                self.postMessage({
                    type: 'ANALYSIS_RESULT',
                    payload: { zoneId, estimatedCount: 0, confidence: 0, isQueueForming: false, timestamp: Date.now() }
                });
                return;
            }

            const instance = await crowdWasm.getInstance();
            const memory = await crowdWasm.getMemory();

            // Copy frames to WASM memory
            const currentPtr = 0;
            const previousPtr = frameData.length;

            const currentView = new Uint8Array(memory.buffer, currentPtr, frameData.length);
            const previousView = new Uint8Array(memory.buffer, previousPtr, frameData.length);

            currentView.set(frameData);
            previousView.set(previousFrame);

            // Result structure is 4 floats: density_map pointer (ignored here for simplicity), count, confidence, padding
            const resultPtr = previousPtr + frameData.length;

            (instance.exports.analyze_crowd_density as CallableFunction)(
                currentPtr,
                previousPtr,
                width,
                height,
                resultPtr
            );

            // Read results (offset 1 and 2 in the result struct)
            const resultView = new Float32Array(memory.buffer, resultPtr + 4, 2);
            const estimatedCount = Math.round(resultView[0]);
            const confidence = resultView[1];

            // Update previous frame for next iteration
            previousFrame.set(frameData);

            const isQueueForming = estimatedCount > 2 && confidence > 0.6;

            self.postMessage({
                type: 'ANALYSIS_RESULT',
                payload: {
                    zoneId,
                    estimatedCount,
                    confidence,
                    isQueueForming,
                    timestamp: Date.now()
                } as QueueAnalysisResult
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
