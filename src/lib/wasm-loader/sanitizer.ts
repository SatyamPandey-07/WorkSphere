/**
 * Utility to asynchronously load the NLP WASM module and manage 
 * shared memory for large document payloads.
 */

let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

export interface SanitizerWasmExports {
    memory: WebAssembly.Memory;
    allocate_buffer: (size: number) => number;
    free_buffer: (ptr: number) => void;
    sanitize_document: (inputPtr: number, len: number, outputPtr: number, tokenPtr: number) => number;
}

export async function loadSanitizerWasm(): Promise<SanitizerWasmExports> {
    if (wasmInstance) {
        return wasmInstance.exports as unknown as SanitizerWasmExports;
    }

    // In a real build pipeline, this would fetch the compiled .wasm binary
    // For this implementation, we assume the WASM is served from /public/wasm/sanitizer.wasm
    const response = await fetch('/wasm/sanitizer.wasm');
    const bytes = await response.arrayBuffer();

    const { instance } = await WebAssembly.instantiate(bytes, {
        env: {
            memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
        },
    });

    wasmInstance = instance;
    wasmMemory = instance.exports.memory as WebAssembly.Memory;

    return instance.exports as unknown as SanitizerWasmExports;
}

export function writeToWasmMemory(exports: SanitizerWasmExports, str: string): number {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = exports.allocate_buffer(bytes.length + 1);

    const memoryView = new Uint8Array(wasmMemory!.buffer);
    memoryView.set(bytes, ptr);
    memoryView[ptr + bytes.length] = 0; // Null terminator

    return ptr;
}

export function readFromWasmMemory(exports: SanitizerWasmExports, ptr: number, len: number): string {
    const memoryView = new Uint8Array(wasmMemory!.buffer);
    const bytes = memoryView.slice(ptr, ptr + len);
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}
