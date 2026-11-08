/**
 * acoustic.ts
 * Utility to asynchronously load, instantiate, and interface with the acoustic WASM module.
 * Provides a clean Promise-based API for the main thread to communicate with the worker.
 * Supports SharedArrayBuffer zero-copy transfer and falls back to asynchronous transferable
 * ArrayBuffer and postMessage structured cloning when crossOriginIsolated is disabled (#5312).
 */

export interface AcousticFingerprintResult {
    dominantBand: string;
    dominantBandIndex: number;
    energies: Record<string, number>;
    sampleRate: number;
}

/**
 * Automatically detects whether the browser environment is cross-origin isolated.
 * When COOP/COEP headers are missing, crossOriginIsolated is false and SharedArrayBuffer is disabled.
 */
export function isCrossOriginIsolated(): boolean {
    return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
}

/**
 * Checks whether SharedArrayBuffer is available and enabled in the current environment.
 */
export function isSharedArrayBufferSupported(): boolean {
    return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined' && isCrossOriginIsolated();
}

export class AcousticFingerprintLoader {
    private worker: Worker | null = null;
    private createWorker?: () => Worker;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;

    constructor(worker?: Worker, createWorker?: () => Worker) {
        if (worker) {
            this.worker = worker;
            this.isReady = true;
            this.readyPromise = Promise.resolve();
        } else {
            this.createWorker = createWorker;
            this.readyPromise = new Promise((resolve) => {
                this.resolveReady = resolve;
            });
        }
    }

    public getExecutionMode(): 'shared-array-buffer' | 'transferable' | 'structured-clone' {
        if (isSharedArrayBufferSupported()) {
            return 'shared-array-buffer';
        }
        return 'transferable';
    }

    public async initialize(
        wasmUrl: string = '/wasm/acoustic_fft.wasm',
        createWorker?: () => Worker
    ): Promise<void> {
        if (typeof Worker === 'undefined') {
            throw new Error('Web Workers are not supported in this environment.');
        }

        const factory = createWorker || this.createWorker;
        if (factory) {
            this.worker = factory();
        } else {
            this.worker = new Worker('/workers/acousticFingerprintWorker.js', { type: 'module' });
        }

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

            const cleanup = () => {
                this.worker?.removeEventListener('message', handleMessage);
                this.worker?.removeEventListener('error', handleError);
            };

            const handleMessage = (event: MessageEvent) => {
                if (event.data.type === 'FINGERPRINT_RESULT') {
                    cleanup();
                    resolve(event.data.payload as AcousticFingerprintResult);
                } else if (event.data.type === 'FINGERPRINT_ERROR' || event.data.type === 'ERROR') {
                    cleanup();
                    reject(new Error(event.data.error || 'Failed to process audio'));
                }
            };

            const handleError = (error: ErrorEvent) => {
                cleanup();
                reject(new Error(error.message || 'Worker encountered an error during audio analysis'));
            };

            this.worker.addEventListener('message', handleMessage);
            this.worker.addEventListener('error', handleError);

            // Strictly downsample high sample rates (96kHz, 192kHz) to 48kHz max at WASM boundary
            // to avoid out-of-bounds heap memory access and buffer overflow (#5279)
            let processedAudio = audioData;
            let effectiveSampleRate = sampleRate;

            if (sampleRate > 48000) {
                const decimationFactor = Math.round(sampleRate / 48000);
                if (decimationFactor > 1) {
                    const downsampledLength = Math.floor(audioData.length / decimationFactor);
                    const downsampledData = new Float32Array(downsampledLength);
                    for (let i = 0; i < downsampledLength; i++) {
                        let sum = 0;
                        for (let j = 0; j < decimationFactor; j++) {
                            sum += audioData[i * decimationFactor + j];
                        }
                        downsampledData[i] = sum / decimationFactor;
                    }
                    processedAudio = downsampledData;
                    effectiveSampleRate = Math.round(sampleRate / decimationFactor);
                }
            }

            // Cap buffer length to maximum FFT window size (4096 samples)
            const MAX_FFT_WINDOW = 4096;
            if (processedAudio.length > MAX_FFT_WINDOW) {
                processedAudio = processedAudio.subarray(0, MAX_FFT_WINDOW);
            }

            // ponytail: detect crossOriginIsolated; use SharedArrayBuffer if available, otherwise transferable ArrayBuffer with fallback to structured cloning
            if (isSharedArrayBufferSupported()) {
                try {
                    const sab = new SharedArrayBuffer(processedAudio.byteLength);
                    new Float32Array(sab).set(processedAudio);
                    const sharedAudio = new Float32Array(sab);
                    this.worker.postMessage({
                        type: 'PROCESS_AUDIO',
                        payload: { audioData: sharedAudio, sampleRate: effectiveSampleRate }
                    });
                    return;
                } catch {
                    // Fall through to transferable ArrayBuffer fallback
                }
            }

            // Fallback for environments where SharedArrayBuffer is disabled (missing COOP headers)
            // Try transferable ArrayBuffer first; if transfer fails, fall back to postMessage structured cloning
            try {
                const transferableData = processedAudio.slice();
                this.worker.postMessage(
                    {
                        type: 'PROCESS_AUDIO',
                        payload: { audioData: transferableData, sampleRate: effectiveSampleRate }
                    },
                    [transferableData.buffer]
                );
            } catch {
                // ponytail: fallback to postMessage structured cloning without crashing WebAssembly audio analysis
                this.worker.postMessage({
                    type: 'PROCESS_AUDIO',
                    payload: { audioData: processedAudio, sampleRate: effectiveSampleRate }
                });
            }
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
