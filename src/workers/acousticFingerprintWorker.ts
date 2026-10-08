/**
 * acousticFingerprintWorker.ts
 * Web Worker script to offload heavy audio processing from the main thread.
 * Receives AudioBuffer data, processes it via WASM, and posts fingerprint results.
 */

let wasmModule: WebAssembly.Module | null = null;
let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

const BAND_NAMES = ['Sub-bass', 'Bass', 'Low-mid', 'Mid', 'High-mid', 'Presence', 'Brilliance'];

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT_WASM') {
        try {
            const response = await fetch(payload.wasmUrl);
            const buffer = await response.arrayBuffer();
            wasmModule = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 256 }),
                }
            };

            wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);
            wasmMemory = importObject.env.memory as WebAssembly.Memory;

            // Initialize with 44100Hz and 1024 buffer size
            (wasmInstance.exports.acoustic_fft_init as CallableFunction)(44100, 1024);

            self.postMessage({ type: 'WASM_READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'WASM_READY', success: false, error: String(error) });
        }
    }

    if (type === 'PROCESS_AUDIO' && wasmInstance && wasmMemory) {
        const { audioData, sampleRate } = payload; // audioData is Float32Array

        // Copy audio data to WASM memory
        const bytesPerFloat = 4;
        const numBytes = audioData.length * bytesPerFloat;

        // Find a free offset in memory (simplified: using offset 0 for this example)
        const memoryView = new Float32Array(wasmMemory.buffer, 0, audioData.length);
        memoryView.set(audioData);

        // Call WASM function
        const dominantBand = (wasmInstance.exports.acoustic_fft_process_block as CallableFunction)(0, audioData.length);

        // Extract energies
        const energies: Record<string, number> = {};
        for (let i = 0; i < 7; i++) {
            const energy = (wasmInstance.exports.acoustic_fft_get_band_energy as CallableFunction)(i);
            energies[BAND_NAMES[i]] = energy;
        }

        self.postMessage({
            type: 'FINGERPRINT_RESULT',
            payload: {
                dominantBand: BAND_NAMES[dominantBand],
                dominantBandIndex: dominantBand,
                energies,
                sampleRate
            }
        });
    }
};
