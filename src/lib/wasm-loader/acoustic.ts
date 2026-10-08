/**
 * acoustic.ts
 * Utility to asynchronously load, instantiate, and interface with the acoustic WASM module.
 * Provides a clean Promise-based API for the main thread to communicate with the worker.
 */

export interface AcousticFingerprintResult {
    dominantBand: string;
    dominantBandIndex: number;
    energies: Record<string, number>;
    sampleRate: number;
}

export class AcousticFingerprintLoader {
    private worker: Worker | null = null;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    public async initialize(wasmUrl: string = '/wasm/acoustic_fft.wasm'): Promise<void> {
        if (typeof Worker === 'undefined') {
            throw new Error('Web Workers are not supported in this environment.');
        }

        this.worker = new Worker(new URL('../../workers/acousticFingerprintWorker.ts', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (event) => {
            const { type, success, error } = event.data;
            if (type === 'WASM_READY') {
                if (success) {
                    this.isReady = true;
                    if (this.resolveReady) this.resolveReady();
                } else {
                    console.error('Failed to initialize WASM acoustic module:', error);
                }
            }
        };

        this.worker.postMessage({
            type: 'INIT_WASM',
            payload: { wasmUrl }
        });

        return this.readyPromise;
    }

    public async processAudio(audioData: Float32Array, sampleRate: number): Promise<AcousticFingerprintResult> {
        await this.readyPromise;

        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (event: MessageEvent) => {
                if (event.data.type === 'FINGERPRINT_RESULT') {
                    this.worker?.removeEventListener('message', handleMessage);
                    resolve(event.data.payload as AcousticFingerprintResult);
                }
            };

            this.worker.addEventListener('message', handleMessage);

            // Transfer the audioData buffer to avoid copying overhead
            this.worker.postMessage(
                {
                    type: 'PROCESS_AUDIO',
                    payload: { audioData, sampleRate }
                },
                [audioData.buffer]
            );
        });
    }

    public terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}

export const acousticLoader = new AcousticFingerprintLoader();
