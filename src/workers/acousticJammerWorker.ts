/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

/**
 * acousticJammerWorker.ts
 * AudioWorklet processor that handles the heavy DSP math for continuous 
 * audio routing and feedback mixing using the WASM DAF engine.
 */

class AcousticJammerProcessor extends AudioWorkletProcessor {
    private wasmInstance: any = null;
    private enginePtr: number = 0;
    private sampleRate: number;
    private isInitialized: boolean = false;

    constructor() {
        super();
        this.sampleRate = sampleRate; // Provided by AudioWorkletGlobalScope

        this.port.onmessage = (event) => {
            if (event.data.type === 'INIT_WASM') {
                this.initializeWasm(event.data.wasmModule, event.data.delayMs, event.data.gain);
            } else if (event.data.type === 'UPDATE_DELAY') {
                this.updateDelay(event.data.delayMs);
            } else if (event.data.type === 'UPDATE_GAIN') {
                this.updateGain(event.data.gain);
            }
        };
    }

    private async initializeWasm(wasmModule: WebAssembly.Module, delayMs: number, gain: number) {
        try {
            this.wasmInstance = await WebAssembly.instantiate(wasmModule, {
                env: {
                    memory: new WebAssembly.Memory({ initial: 256, maximum: 512 })
                }
            });

            const exports = this.wasmInstance.exports as any;
            this.enginePtr = exports.daf_create(this.sampleRate, delayMs, gain);
            this.isInitialized = true;
            this.port.postMessage({ type: 'WASM_READY' });
        } catch (error) {
            console.error('[JammerWorker] WASM Init failed:', error);
        }
    }

    private updateDelay(delayMs: number) {
        if (this.isInitialized && this.enginePtr) {
            const exports = this.wasmInstance.exports as any;
            exports.daf_update_delay(this.enginePtr, this.sampleRate, delayMs);
        }
    }

    private updateGain(gain: number) {
        // In a full implementation, we would expose a daf_update_gain C function
        // For now, we recreate or rely on the delay update if gain is static
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || input.length === 0 || !input[0] || !output[0]) {
            return true; // Keep alive
        }

        const channelData = input[0];
        const outputData = output[0];

        if (!this.isInitialized || !this.wasmInstance || !this.enginePtr) {
            // Passthrough if WASM isn't ready
            outputData.set(channelData);
            return true;
        }

        const exports = this.wasmInstance.exports as any;
        const memory = exports.memory as WebAssembly.Memory;

        const numSamples = channelData.length;
        const inputPtr = exports.malloc(numSamples * 4); // 4 bytes per float
        const outputPtr = exports.malloc(numSamples * 4);

        const inputView = new Float32Array(memory.buffer, inputPtr, numSamples);
        const outputView = new Float32Array(memory.buffer, outputPtr, numSamples);

        inputView.set(channelData);

        exports.daf_process(this.enginePtr, inputPtr, outputPtr, numSamples);

        outputData.set(outputView);

        exports.free(inputPtr);
        exports.free(outputPtr);

        return true;
    }
}

registerProcessor('acoustic-jammer-processor', AcousticJammerProcessor);
