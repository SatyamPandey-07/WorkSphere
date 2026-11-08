/**
 * Compression Worker
 * Interfaces with the Brotli WASM module to compress large telemetry batches.
 */

import { initBrotli, compressData, loadInput } from '@/lib/wasm-loader/brotli';

let isWasmReady = false;

self.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data;

    if (action === 'INIT') {
        try {
            await initBrotli(6); // Quality 6 is a good balance
            isWasmReady = true;
            self.postMessage({ action: 'WASM_READY' });
        } catch (err: any) {
            self.postMessage({ action: 'WASM_ERROR', error: err.message });
        }
        return;
    }

    if (action === 'COMPRESS_BATCH') {
        if (!isWasmReady) {
            self.postMessage({ action: 'ERROR', error: 'WASM not ready' });
            return;
        }

        const { batchId, data } = payload; // data is ArrayBuffer

        try {
            loadInput(new Uint8Array(data));
            const compressedSize = compressData();

            // In a real WASM setup, we'd read the output buffer pointer and length
            // Mocking the compressed result extraction
            const compressedData = new ArrayBuffer(compressedSize);

            self.postMessage(
                { action: 'COMPRESSION_COMPLETE', batchId, data: compressedData },
                [compressedData] // Transferable
            );
        } catch (err: any) {
            self.postMessage({ action: 'ERROR', error: err.message });
        }
    }
});

export { };
