/**
 * acousticFingerprintWorker.ts
 * Web Worker script to offload heavy audio processing from the main thread.
 * Receives AudioBuffer data, processes it via WASM, and posts fingerprint results.
 * Supports SharedArrayBuffer, transferable ArrayBuffer, and structured cloning (#5312).
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
        try {
            const { audioData, sampleRate } = payload; // audioData is Float32Array (SAB, transferred, or structured cloned)

            if (!audioData || audioData.length === 0) {
                self.postMessage({
                    type: 'FINGERPRINT_ERROR',
                    error: 'Empty audioData received'
                });
                return;
            }

            // Ensure WASM linear memory has sufficient pages for audioData
            const requiredBytes = audioData.length * 4;
            const currentBytes = wasmMemory.buffer.byteLength;
            if (requiredBytes > currentBytes) {
                const additionalBytes = requiredBytes - currentBytes;
                const additionalPages = Math.ceil(additionalBytes / 65536);
                wasmMemory.grow(additionalPages);
            }

            // Update sample rate in WASM engine if sampleRate provided
            if (sampleRate && typeof (wasmInstance.exports.acoustic_fft_init as CallableFunction) === 'function') {
                (wasmInstance.exports.acoustic_fft_init as CallableFunction)(sampleRate, Math.min(audioData.length, 4096));
            }

            // Copy audio data to WASM memory
            // Find a free offset in memory (using offset 0)
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
        } catch (error) {
            // ponytail: catch processing errors so worker thread stays alive
            self.postMessage({
                type: 'FINGERPRINT_ERROR',
                error: String(error)
            });
        }
    }
};
