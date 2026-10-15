/**
 * Web Worker that chunks large PDF/DOCX text extractions and streams 
 * them to the WASM module for sanitization.
 */

import {
    loadSanitizerWasm,
    writeToWasmMemory,
    readFromWasmMemory,
    SanitizerWasmExports
} from '../lib/wasm-loader/sanitizer';

let wasmExports: SanitizerWasmExports | null = null;
const REDACTION_TOKEN = '[REDACTED]';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            wasmExports = await loadSanitizerWasm();
            self.postMessage({ type: 'READY' });
        } catch (err: any) {
            self.postMessage({ type: 'ERROR', message: err.message });
        }
        return;
    }

    if (type === 'SANITIZE') {
        if (!wasmExports) {
            self.postMessage({ type: 'ERROR', message: 'WASM not initialized' });
            return;
        }

        const { text, docId } = payload;

        try {
            // Chunking logic for extremely large documents to avoid WASM memory limits
            const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            let sanitizedText = '';

            for (let i = 0; i < text.length; i += CHUNK_SIZE) {
                const chunk = text.substring(i, i + CHUNK_SIZE);

                const inputPtr = writeToWasmMemory(wasmExports, chunk);
                const inputLen = new TextEncoder().encode(chunk).length;

                // Allocate output buffer (worst case: every char is replaced by token, but realistically smaller)
                const maxOutputSize = inputLen * REDACTION_TOKEN.length;
                const outputPtr = wasmExports.allocate_buffer(maxOutputSize);
                const tokenPtr = writeToWasmMemory(wasmExports, REDACTION_TOKEN);

                const outputLen = wasmExports.sanitize_document(inputPtr, inputLen, outputPtr, tokenPtr);
                const sanitizedChunk = readFromWasmMemory(wasmExports, outputPtr, outputLen);

                sanitizedText += sanitizedChunk;

                // Free memory
                wasmExports.free_buffer(inputPtr);
                wasmExports.free_buffer(outputPtr);
                wasmExports.free_buffer(tokenPtr);
            }

            self.postMessage({
                type: 'SANITIZED',
                payload: { docId, text: sanitizedText }
            });
        } catch (err: any) {
            self.postMessage({ type: 'ERROR', message: err.message });
        }
    }
};
