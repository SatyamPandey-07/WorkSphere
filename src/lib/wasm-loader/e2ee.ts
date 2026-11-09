/**
 * e2ee.ts
 * Secure wrapper for initializing the WASM crypto module and generating secure random bytes.
 * Provides a clean Promise-based API for the main thread to manage cryptographic operations.
 */

export class E2EEWasmLoader {
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

    public async initialize(wasmUrl: string = '/wasm/crypto.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 64 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(module, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize E2EE WASM:', error);
            throw error;
        }
    }

    public async generateSecureRandomBytes(length: number): Promise<Uint8Array> {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const array = new Uint8Array(length);
            crypto.getRandomValues(array);
            return array;
        }
        throw new Error('Secure random number generation not available');
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

export const e2eeWasm = new E2EEWasmLoader();
