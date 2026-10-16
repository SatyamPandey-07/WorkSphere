/// <reference lib="webworker" />
declare const self: AudioWorkletGlobalScope;

interface WasmExports {
    memory: WebAssembly.Memory;
    init_keystroke_profiles: () => void;
    generate_keystroke_sound: (out: number, samples: number, profile: number) => void;
    generate_random_sequence: (out: number, samples: number, rate: number) => void;
    init_injector: () => void;
    inject_keystroke_audio: (buf: number, samples: number) => void;
    mix_and_output: (mic: number, out: number, samples: number, ratio: number) => void;
    apply_frequency_mask: (buf: number, samples: number, freq: number, bw: number) => void;
}

class AcousticShieldProcessor extends AudioWorkletProcessor {
    private wasmInstance: WasmExports | null = null;
    private isInitialized: boolean = false;
    private mixRatio: number = 0.6;
    private keystrokeRate: number = 8;

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
        this.initWasm();
    }

    private async initWasm() {
        try {
            const response = await fetch('/wasm/acoustic_shield.wasm');
            const bytes = await response.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(bytes, {
                env: { memory: new WebAssembly.Memory({ initial: 256 }) },
            });
            this.wasmInstance = instance.exports as unknown as WasmExports;
            this.wasmInstance.init_keystroke_profiles();
            this.wasmInstance.init_injector();
            this.isInitialized = true;
            this.port.postMessage({ type: 'WASM_READY' });
        } catch (error) {
            this.port.postMessage({ type: 'WASM_ERROR', error: String(error) });
        }
    }

    private handleMessage(event: MessageEvent) {
        const { type, payload } = event.data;
        if (type === 'UPDATE_MIX_RATIO') {
            this.mixRatio = payload.ratio;
        } else if (type === 'UPDATE_KEYSTROKE_RATE') {
            this.keystrokeRate = payload.rate;
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        if (!this.isInitialized || !this.wasmInstance) return true;

        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0] || !output || !output[0]) return true;

        const channelData = input[0];
        const outputData = output[0];
        const numSamples = channelData.length;

        const heapSize = numSamples * 4;
        const keystrokePtr = 0;
        const micPtr = heapSize;
        const outPtr = heapSize * 2;

        const heap = new Float32Array(this.wasmInstance.memory.buffer);

        heap.set(channelData, micPtr / 4);

        this.wasmInstance.generate_random_sequence(keystrokePtr / 4, numSamples, this.keystrokeRate);

        this.wasmInstance.inject_keystroke_audio(keystrokePtr / 4, numSamples);

        this.wasmInstance.mix_and_output(micPtr / 4, outPtr / 4, numSamples, this.mixRatio);

        const processed = new Float32Array(this.wasmInstance.memory.buffer, outPtr, numSamples);
        outputData.set(processed);

        return true;
    }
}

registerProcessor('acoustic-shield-processor', AcousticShieldProcessor);
