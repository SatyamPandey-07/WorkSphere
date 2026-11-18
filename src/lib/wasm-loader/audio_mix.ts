/**
 * audio_mix.ts
 * Utility to initialize the audio WASM module and manage the ring buffers for real-time DSP.
 */

export interface AudioMixWasmModule {
    generateInverseMask: (
        input: Float32Array,
        output: Float32Array,
        size: number,
        sampleRate: number,
        intensity: number
    ) => boolean;
    generateBrownNoise: (
        output: Float32Array,
        size: number,
        amplitude: number
    ) => void;
}

class MockAudioMixWasm implements AudioMixWasmModule {
    generateInverseMask(
        input: Float32Array,
        output: Float32Array,
        size: number,
        sampleRate: number,
        intensity: number
    ): boolean {
        // Mock FFT and inverse phase generation
        for (let i = 0; i < size; i++) {
            // Simple inversion with some randomization to simulate frequency masking
            output[i] = -input[i] * intensity * (0.8 + Math.random() * 0.4);
        }
        return true;
    }

    generateBrownNoise(output: Float32Array, size: number, amplitude: number): void {
        let lastOut = 0.0;
        for (let i = 0; i < size; i++) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            output[i] = lastOut * amplitude;
        }
    }
}

let wasmInstance: AudioMixWasmModule | null = null;
let isLoading: boolean = false;
let loadPromise: Promise<AudioMixWasmModule> | null = null;

export async function loadAudioMixWasm(): Promise<AudioMixWasmModule> {
    if (wasmInstance) return wasmInstance;
    if (loadPromise) return loadPromise;

    isLoading = true;
    loadPromise = new Promise(async (resolve, reject) => {
        try {
            // In production:
            // const wasmUrl = new URL('../../wasm/audio/frequency_mask.wasm', import.meta.url);
            // const response = await fetch(wasmUrl);
            // const bytes = await response.arrayBuffer();
            // const { instance } = await WebAssembly.instantiate(bytes, {
            //   env: {
            //     memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
            //     // ... other imports
            //   }
            // });
            // wasmInstance = instance.exports as unknown as AudioMixWasmModule;

            console.log('[WASM Loader] Initializing mock Audio Mix WASM module');
            // Simulate async loading delay
            await new Promise(r => setTimeout(r, 100));

            wasmInstance = new MockAudioMixWasm();
            resolve(wasmInstance);
        } catch (err) {
            console.error('[WASM Loader] Failed to load audio mix WASM:', err);
            reject(err);
        } finally {
            isLoading = false;
        }
    });

    return loadPromise;
}

export function isWasmLoading(): boolean {
    return isLoading;
}

export function getWasmInstance(): AudioMixWasmModule | null {
    return wasmInstance;
}

/**
 * Ring buffer utility for managing continuous audio streams between threads.
 */
export class AudioRingBuffer {
    private buffer: Float32Array;
    private writeIndex: number = 0;
    private readIndex: number = 0;
    private capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
    }

    public write(data: Float32Array): void {
        for (let i = 0; i < data.length; i++) {
            this.buffer[this.writeIndex] = data[i];
            this.writeIndex = (this.writeIndex + 1) % this.capacity;

            // Prevent overwrite unread data
            if (this.writeIndex === this.readIndex) {
                this.readIndex = (this.readIndex + 1) % this.capacity;
            }
        }
    }

    public read(output: Float32Array): number {
        let count = 0;
        while (count < output.length && this.readIndex !== this.writeIndex) {
            output[count] = this.buffer[this.readIndex];
            this.readIndex = (this.readIndex + 1) % this.capacity;
            count++;
        }
        return count;
    }

    public available(): number {
        if (this.writeIndex >= this.readIndex) {
            return this.writeIndex - this.readIndex;
        }
        return this.capacity - this.readIndex + this.writeIndex;
    }

    public clear(): void {
        this.writeIndex = 0;
        this.readIndex = 0;
    }
}
