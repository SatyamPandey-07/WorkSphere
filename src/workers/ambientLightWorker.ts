/**
 * ambientLightWorker.ts
 * Web Worker that streams video frames and sensor data to the WASM module for real-time lighting analysis.
 * Offloads heavy pixel processing to prevent main thread jank.
 */

import { lightingWasm } from '@/lib/wasm-loader/lighting';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await lightingWasm.initialize(payload.wasmUrl);
            self.postMessage({ type: 'READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'READY', success: false, error: String(error) });
        }
    }

    if (type === 'ANALYZE_FRAME') {
        try {
            const { rgbData, width, height } = payload;
            const instance = await lightingWasm.getInstance();
            const memory = await lightingWasm.getMemory();

            // Copy RGB data to WASM memory
            const bufferSize = width * height * 3;
            const ptr = 0;
            const view = new Uint8Array(memory.buffer, ptr, bufferSize);
            view.set(rgbData);

            // Allocate output pointers
            const cctPtr = bufferSize;
            const luxPtr = bufferSize + 4;

            // Call WASM function
            (instance.exports.analyze_ambient_light as CallableFunction)(
                ptr,
                width,
                height,
                cctPtr,
                luxPtr
            );

            // Read results
            const cctView = new Float32Array(memory.buffer, cctPtr, 1);
            const luxView = new Float32Array(memory.buffer, luxPtr, 1);

            self.postMessage({
                type: 'ANALYSIS_RESULT',
                payload: {
                    cct: cctView[0],
                    lux: luxView[0]
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
