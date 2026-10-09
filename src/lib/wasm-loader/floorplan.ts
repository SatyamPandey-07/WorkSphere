/**
 * floorplan.ts
 * Utility to asynchronously load the WASM module and manage memory allocation for image buffers.
 * Provides a clean Promise-based API for the main thread to communicate with the floorplan worker.
 */

export interface VectorizationResult {
    polygons: { x: number; y: number }[][];
    width: number;
    height: number;
}

export class FloorplanWasmLoader {
    private wasmModule: WebAssembly.Module | null = null;
    private wasmInstance: WebAssembly.Instance | null = null;
    private wasmMemory: WebAssembly.Memory | null = null;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    public async initialize(wasmUrl: string = '/wasm/floorplan.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            this.wasmModule = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 256 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(this.wasmModule, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize Floorplan WASM:', error);
            throw error;
        }
    }

    public async getMemory(): Promise<WebAssembly.Memory> {
        await this.readyPromise;
        if (!this.wasmMemory) throw new Error('WASM memory not initialized');
        return this.wasmMemory;
    }

    public async getInstance(): Promise<WebAssembly.Instance> {
        await this.readyPromise;
        if (!this.wasmInstance) throw new Error('WASM instance not initialized');
        return this.wasmInstance;
    }
}

export const floorplanWasm = new FloorplanWasmLoader();
