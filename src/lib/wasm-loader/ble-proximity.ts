/**
 * ble-proximity.ts
 * Utility to asynchronously load the WASM spatial module and manage memory for signal arrays.
 * Provides a clean Promise-based API for the main thread to communicate with the BLE worker.
 */

export interface FilteredBeaconData {
    beaconId: string;
    smoothedX: number;
    smoothedY: number;
    confidence: number;
}

export class BLEProximityWasmLoader {
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

    public async initialize(wasmUrl: string = '/wasm/ble_kalman.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 16 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(module, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize BLE Proximity WASM:', error);
            throw error;
        }
    }

    public async getInstance(): Promise<WebAssembly.Instance> {
        await this.readyPromise;
        if (!this.wasmInstance) throw new Error('WASM instance not initialized');
        return this.wasmInstance;
    }

    public async getMemory(): Promise<WebAssembly.Memory> {
        await this.readyPromise;
        if (!this.wasmMemory) throw new Error('WASM memory not initialized');
        return this.wasmMemory;
    }
}

export const bleProximityWasm = new BLEProximityWasmLoader();
