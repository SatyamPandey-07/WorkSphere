/**
 * floorplanWorker.ts
 * Web Worker script to offload heavy pixel manipulation and vectorization logic.
 * Receives image data, processes it through the WASM pipeline, and returns vector polygons.
 */

import { floorplanWasm } from '@/lib/wasm-loader/floorplan';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await floorplanWasm.initialize(payload.wasmUrl);
            self.postMessage({ type: 'READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'READY', success: false, error: String(error) });
        }
    }

    if (type === 'VECTORIZE') {
        try {
            const { imageData, width, height, threshold } = payload;
            const instance = await floorplanWasm.getInstance();
            const memory = await floorplanWasm.getMemory();

            const bytesPerPixel = 1; // Grayscale
            const inputSize = width * height * bytesPerPixel;
            const outputSize = width * height * bytesPerPixel;

            // Allocate memory in WASM
            const inputPtr = 0;
            const outputPtr = inputSize;

            const inputView = new Uint8Array(memory.buffer, inputPtr, inputSize);
            inputView.set(imageData);

            // Call Sobel edge detection
            (instance.exports.apply_sobel_edge_detection as CallableFunction)(
                inputPtr,
                outputPtr,
                width,
                height,
                threshold
            );

            // Call Contour tracing
            // Note: In a real implementation, we would read the polygon pointers returned by C
            // For this scaffold, we simulate returning a simplified polygon structure
            const mockPolygons = [
                [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 10 }],
                [{ x: 150, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 200 }, { x: 150, y: 200 }]
            ];

            self.postMessage({
                type: 'VECTORIZE_RESULT',
                payload: {
                    polygons: mockPolygons,
                    width,
                    height
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
