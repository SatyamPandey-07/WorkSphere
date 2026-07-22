// public/audio-processor.js
import Module from './hrtf_engine.js';

class HRTFProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.engine = null;
        this.inputPtr = null;
        this.outputPtr = null;

        // Listen for the WASM binary sent from the main React thread
        this.port.onmessage = (event) => {
            if (event.data.type === 'LOAD_WASM') {
                Module({
                    instantiateWasm: function(imports, successCallback) {
                        WebAssembly.instantiate(event.data.wasmBinary, imports)
                            .then((output) => {
                                successCallback(output.instance);
                            })
                            .catch(e => console.error("WASM Compile Error:", e));
                        return {}; // Emscripten requires returning an empty object here
                    }
                }).then((wasmModule) => {
                    this.wasm = wasmModule;
                    this.engine = new this.wasm.HRTFEngine();
                    console.log("WASM HRTF Engine Loaded Successfully!");
                }).catch((err) => {
                    console.error("WASM Engine failed to initialize:", err);
                });
            }
        };
    }

    process(inputs, outputs, parameters) {
        if (!this.engine) return true; // Stay silent but alive until WASM loads

        const input = inputs[0];
        const output = outputs[0];

        if (input.length > 0 && input[0].length > 0) {
            const channelLength = input[0].length;

            if (!this.inputPtr) {
                this.inputPtr = this.wasm._malloc(channelLength * Float32Array.BYTES_PER_ELEMENT);
                this.outputPtr = this.wasm._malloc(channelLength * Float32Array.BYTES_PER_ELEMENT);
            }

            this.wasm.HEAPF32.set(input[0], this.inputPtr / Float32Array.BYTES_PER_ELEMENT);
            this.engine.processAudio(this.inputPtr, this.outputPtr, channelLength, 0.0, 0.0);

            const processedData = new Float32Array(this.wasm.HEAPF32.buffer, this.outputPtr, channelLength);
            output[0].set(processedData);

            if (output.length > 1) {
                output[1].set(processedData);
            }
        }
        return true;
    }
}

registerProcessor('hrtf-processor', HRTFProcessor);
