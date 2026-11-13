
/**
 * Compression Worker
 * Interfaces with the Brotli WASM module to compress large telemetry batches.
 */

import {
    initBrotli,
    compressData,
    loadInput,
} from '@/lib/wasm-loader/brotli';

const worker = self as DedicatedWorkerGlobalScope;

let isWasmReady = false;
let initPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : String(error);
}

worker.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data ?? {};

    if (action === 'INIT') {
        try {
            if (!initPromise) {
                initPromise = initBrotli(6).then(() => {
                    isWasmReady = true;
                }).catch((error) => {
                    initPromise = null;
                    throw error;
                });
            }

            await initPromise;

            worker.postMessage({ action: 'WASM_READY' });
        } catch (error: unknown) {
            worker.postMessage({
                action: 'WASM_ERROR',
                error: getErrorMessage(error),
            });
        }

        return;
    }

    if (action === 'COMPRESS_BATCH') {
        if (!isWasmReady) {
            worker.postMessage({
                action: 'ERROR',
                error: 'WASM not ready',
            });
            return;
        }

        if (!payload || !(payload.data instanceof ArrayBuffer)) {
            worker.postMessage({
                action: 'ERROR',
                error: 'Invalid compression payload',
            });
            return;
        }

        const { batchId, data } = payload;

        try {
            loadInput(new Uint8Array(data));

            const compressedSize = compressData();

            // IMPORTANT:
            // Replace this with the actual WASM output extraction.
            // This buffer is not compressed data.
            const compressedData = new ArrayBuffer(compressedSize);

            worker.postMessage(
                {
                    action: 'COMPRESSION_COMPLETE',
                    batchId,
                    data: compressedData,
                },
                [compressedData]
            );
        } catch (error: unknown) {
            worker.postMessage({
                action: 'ERROR',
                batchId,
                error: getErrorMessage(error),
            });
        }
    }
});

export {};
