/**
 * AudioWorklet processor that handles the heavy DSP math for 
 * continuous audio synthesis off the main thread.
 */

// Note: In a real Next.js app, AudioWorklets require specific bundling.
// This represents the logic that would run inside the AudioWorkletGlobalScope.

class AmbientSynthProcessor extends AudioWorkletProcessor {
    private wasmInstance: any = null;
    private grainSourcePtr: number = 0;
    private lfoPtr: number = 0;
    private lfoBuffer: Float32Array;

    constructor() {
        super();
        this.lfoBuffer = new Float32Array(128); // Block size

        this.port.onmessage = (event) => {
            if (event.data.type === 'INIT_WASM') {
                // In production, instantiate WASM here
                this.wasmInstance = event.data.exports;
                this.grainSourcePtr = this.wasmInstance.create_grain_source(44100, sampleRate);
                this.lfoPtr = this.wasmInstance.create_lfo(0.5, sampleRate);
            }

            if (event.data.type === 'LOAD_AUDIO_GRAIN') {
                if (this.wasmInstance && this.grainSourcePtr) {
                    // Copy audio data into WASM memory
                    const ptr = this.wasmInstance.allocate_buffer(event.data.buffer.length * 4);
                    new Float32Array(this.wasmInstance.memory.buffer, ptr, event.data.buffer.length).set(event.data.buffer);
                    this.wasmInstance.load_grain_buffer(this.grainSourcePtr, ptr, event.data.buffer.length);
                    this.wasmInstance.free_buffer(ptr);
                }
            }

            if (event.data.type === 'UPDATE_PARAMS') {
                if (this.wasmInstance && this.lfoPtr) {
                    this.wasmInstance.set_lfo_frequency(this.lfoPtr, event.data.lfoFreq);
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const output = outputs[0];
        const channelData = output[0];

        if (!this.wasmInstance || !this.grainSourcePtr) {
            // Output silence if WASM isn't ready
            channelData.fill(0);
            return true;
        }

        // Generate LFO modulation values for this block
        this.wasmInstance.process_lfo(this.lfoPtr, this.lfoBuffer, channelData.length);

        // Allocate output buffer in WASM memory
        const outPtr = this.wasmInstance.allocate_buffer(channelData.length * 4);

        // Synthesize grains
        // density = 50, duration = 100ms, pitch = 1.0 (modulated by LFO in real impl)
        this.wasmInstance.synthesize_grains(this.grainSourcePtr, outPtr, channelData.length, 50, 100, 1.0);

        // Copy back to JS
        const wasmOut = new Float32Array(this.wasmInstance.memory.buffer, outPtr, channelData.length);

        // Apply LFO amplitude modulation
        for (let i = 0; i < channelData.length; i++) {
            channelData[i] = wasmOut[i] * this.lfoBuffer[i];
        }

        this.wasmInstance.free_buffer(outPtr);

        return true;
    }
}

registerProcessor('ambient-synth-processor', AmbientSynthProcessor);
