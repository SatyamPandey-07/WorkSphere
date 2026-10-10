/**
 * ocrWorker.ts
 * Web Worker that processes the image buffer through the WASM pipeline and outputs raw text coordinates.
 */

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'PROCESS_IMAGE') {
        try {
            const { imageData, width, height, wasmUrl } = payload;

            // Initialize WASM (mocked for scaffold)
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = { env: { memory: new WebAssembly.Memory({ initial: 256 }) } };
            const instance = await WebAssembly.instantiate(module, importObject);
            const memory = importObject.env.memory as WebAssembly.Memory;

            // Copy image data to WASM
            const pixelCount = width * height;
            const grayscale = new Uint8Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                const r = imageData[i * 4];
                const g = imageData[i * 4 + 1];
                const b = imageData[i * 4 + 2];
                grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            }

            const imgPtr = 0;
            const binPtr = pixelCount;

            const imgView = new Uint8Array(memory.buffer, imgPtr, pixelCount);
            imgView.set(grayscale);

            // Run pipeline
            (instance.exports.apply_median_filter as CallableFunction)(imgPtr, width, height);
            (instance.exports.apply_otsu_threshold as CallableFunction)(imgPtr, binPtr, width, height);

            // Mock segmentation result
            const mockBoxes = [
                { x_min: 10, y_min: 10, x_max: 50, y_max: 30 },
                { x_min: 60, y_min: 10, x_max: 100, y_max: 30 }
            ];

            self.postMessage({
                type: 'OCR_RESULT',
                payload: {
                    boxes: mockBoxes,
                    width,
                    height
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
