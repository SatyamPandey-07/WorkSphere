/**
 * attestation.ts
 * Utility to load the ECDSA WASM module and perform client-side verification of PoAP badges without server roundtrips.
 */

export class AttestationWasmLoader {
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

    public async initialize(wasmUrl: string = '/wasm/ecdsa_verify.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 32 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(module, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize Attestation WASM:', error);
            throw error;
        }
    }

    public async verifySignature(
        publicKeyHex: string,
        message: string,
        signatureHex: string
    ): Promise<boolean> {
        await this.readyPromise;
        if (!this.wasmInstance || !this.wasmMemory) {
            throw new Error('WASM instance not initialized');
        }

        const publicKey = new Uint8Array(this.hexToBytes(publicKeyHex));
        const messageBytes = new TextEncoder().encode(message);
        const signature = new Uint8Array(this.hexToBytes(signatureHex));

        const pkPtr = 0;
        const msgPtr = 32;
        const sigPtr = msgPtr + messageBytes.length;

        const memoryView = new Uint8Array(this.wasmMemory.buffer);
        memoryView.set(publicKey, pkPtr);
        memoryView.set(messageBytes, msgPtr);
        memoryView.set(signature, sigPtr);

        const verifyFn = this.wasmInstance.exports.ecdsa_verify_attestation as CallableFunction;
        const result = verifyFn(pkPtr, msgPtr, messageBytes.length, sigPtr);

        return result === 0;
    }

    private hexToBytes(hex: string): number[] {
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        return bytes;
    }
}

export const attestationWasm = new AttestationWasmLoader();
